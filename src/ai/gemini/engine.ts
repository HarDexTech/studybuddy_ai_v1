import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { stripCodeFences } from '@/ai/api';

const DIRECT_CALL_MAX_ATTEMPTS = 2;
const DIRECT_CALL_TIMEOUT_MS = 10000;
const FALLBACK_GLOBAL_TIMEOUT_MS = 25000;

// Single Gemini plugin using primary API key
const geminiPlugin = googleAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export const ai = genkit({
  plugins: [geminiPlugin],
  model: 'googleai/gemini-2.5-flash', // Using 2.5 Flash (stable, better limits)
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorText(error: unknown): string {
  const message = (error as any)?.message ?? '';
  return `${message} ${String(error ?? '')}`.toLowerCase();
}

function createTemporaryUnavailableError(cause?: unknown): Error {
  const error = new Error('AI_TEMP_UNAVAILABLE: AI service temporarily unavailable. Please retry in a moment.');
  (error as any).cause = cause;
  return error;
}

function getGeminiApiKeys(): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  const pushKey = (value?: string) => {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    keys.push(trimmed);
  };

  pushKey(process.env.GEMINI_API_KEY);

  for (const [key, value] of Object.entries(process.env)) {
    if (/^GEMINI_API_KEY_\d+$/.test(key)) {
      pushKey(value);
    }
  }

  return keys;
}

// Helper function to check if error is rate limit or quota
export function isRateLimitError(error: any): boolean {
  const text = extractErrorText(error);

  return text.includes('rate limit') || text.includes('quota') || text.includes('429') || text.includes('resource exhausted');
}

export function isTransientGeminiError(error: any): boolean {
  const text = extractErrorText(error);

  return text.includes('fetch failed') || text.includes('econnreset') || text.includes('etimedout') || text.includes('timed out') || text.includes('timeout') || text.includes('eai_again') || text.includes('enotfound') || text.includes('service unavailable') || text.includes('bad gateway') || text.includes('gateway timeout') || text.includes('503') || text.includes('502') || text.includes('504');
}

/**
 * Call Gemini API directly with second API key
 */
async function callGeminiDirectly(model: string, systemInstruction: string, userPrompt: string, apiKey: string): Promise<any> {
  let lastError: unknown;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= DIRECT_CALL_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DIRECT_CALL_TIMEOUT_MS);

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `${systemInstruction}\n\n${userPrompt}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const statusError = new Error(`Gemini API error (${response.status}): ${errorText}`);

        if (isRateLimitError(statusError) || isTransientGeminiError(statusError)) {
          lastError = statusError;
          if (attempt < DIRECT_CALL_MAX_ATTEMPTS) {
            await sleep(Math.min(attempt * 400, 1000));
            continue;
          }
        }

        throw statusError;
      }

      const data = await response.json();

      if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text;
      }

      throw new Error('Invalid Gemini API response format');
    } catch (error) {
      lastError = error;
      if (attempt < DIRECT_CALL_MAX_ATTEMPTS && isTransientGeminiError(error)) {
        await sleep(Math.min(attempt * 400, 1000));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  console.warn('Gemini direct fallback exhausted', {
    attempts: DIRECT_CALL_MAX_ATTEMPTS,
    elapsedMs: Date.now() - startedAt,
  });

  throw lastError instanceof Error ? lastError : new Error('Failed direct Gemini call');
}

/**
 * Fallback wrapper that switches to second Gemini API key on rate limit
 */
export async function withDualGeminiFallback<T>(
  operation: () => Promise<T>,
  fallbackParams?: {
    systemInstruction: string;
    userPrompt: string;
    parseResponse?: (rawResponse: string) => T;
  },
): Promise<T> {
  const startedAt = Date.now();

  const operationTimeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(createTemporaryUnavailableError('Primary operation timeout')), FALLBACK_GLOBAL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operation(), operationTimeout]);
  } catch (error) {
    const shouldFallback = isRateLimitError(error) || isTransientGeminiError(error);

    if (!shouldFallback || !fallbackParams) {
      throw createTemporaryUnavailableError(error);
    }

    const keys = getGeminiApiKeys();
    if (keys.length === 0) {
      throw createTemporaryUnavailableError(error);
    }

    const primary = process.env.GEMINI_API_KEY?.trim();
    const orderedKeys = [...keys.filter((key) => key !== primary), ...keys.filter((key) => key === primary)];

    let lastFallbackError: unknown = error;
    const maxKeysToTry = Math.min(orderedKeys.length, 2);

    for (let index = 0; index < maxKeysToTry; index++) {
      const key = orderedKeys[index];
      if (Date.now() - startedAt >= FALLBACK_GLOBAL_TIMEOUT_MS) {
        break;
      }

      try {
        const rawResponse = await callGeminiDirectly('gemini-2.5-flash', fallbackParams.systemInstruction, fallbackParams.userPrompt, key);

        if (fallbackParams.parseResponse) {
          return fallbackParams.parseResponse(rawResponse);
        }

        return rawResponse as T;
      } catch (fallbackError) {
        lastFallbackError = fallbackError;
        console.warn('Gemini fallback key failed', {
          keyIndex: index + 1,
          totalKeysTried: maxKeysToTry,
          elapsedMs: Date.now() - startedAt,
          transient: isTransientGeminiError(fallbackError),
          rateLimited: isRateLimitError(fallbackError),
        });
      }
    }

    throw createTemporaryUnavailableError(lastFallbackError);
  }
}

// ---------------------------------------------------------------------------
// Gemini JSON helpers — same interface as DeepSeek's callNimJson/callNimJsonStream
// so the provider layer can dispatch to either backend uniformly.
// ---------------------------------------------------------------------------

export interface CallGeminiJsonOptions {
  temperature?: number;
  maxOutputTokens?: number;
  skipStripFences?: boolean;
  timeoutMs?: number;
}

export async function callGeminiJson<T>(
  systemInstruction: string,
  userPrompt: string,
  parse: (raw: string) => T,
  options: CallGeminiJsonOptions = {},
): Promise<T> {
  const { skipStripFences = false } = options;
  const parseText = (raw: string) =>
    parse(skipStripFences ? raw.trim() : stripCodeFences(raw).trim());

  const primary = async (): Promise<T> => {
    const response = await ai.generate({
      model: 'googleai/gemini-2.5-flash',
      system: systemInstruction,
      prompt: userPrompt,
      config: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxOutputTokens ?? 8192,
      },
    });
    const text = response.text;
    if (!text.trim()) {
      throw new Error('AI_TEMP_UNAVAILABLE: Gemini returned empty response.');
    }
    return parseText(text);
  };

  return withDualGeminiFallback<T>(primary, {
    systemInstruction,
    userPrompt,
    parseResponse: parseText,
  });
}

export interface CallGeminiJsonStreamOptions {
  temperature?: number;
  maxOutputTokens?: number;
  onChunk?: (accumulated: string) => void;
  skipStripFences?: boolean;
  timeoutMs?: number;
}

export async function callGeminiJsonStream(
  systemInstruction: string,
  userPrompt: string,
  options: CallGeminiJsonStreamOptions = {},
): Promise<string> {
  return callGeminiJson(
    systemInstruction,
    userPrompt,
    (raw) => {
      options.onChunk?.(raw);
      return raw;
    },
    options,
  );
}
