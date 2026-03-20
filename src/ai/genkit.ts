import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

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

  return (
    text.includes('rate limit') ||
    text.includes('quota') ||
    text.includes('429') ||
    text.includes('resource exhausted')
  );
}

export function isTransientGeminiError(error: any): boolean {
  const text = extractErrorText(error);

  return (
    text.includes('fetch failed') ||
    text.includes('econnreset') ||
    text.includes('etimedout') ||
    text.includes('timed out') ||
    text.includes('timeout') ||
    text.includes('eai_again') ||
    text.includes('enotfound') ||
    text.includes('service unavailable') ||
    text.includes('bad gateway') ||
    text.includes('gateway timeout') ||
    text.includes('503') ||
    text.includes('502') ||
    text.includes('504')
  );
}

/**
 * Call Gemini API directly with second API key
 */
async function callGeminiDirectly(
  model: string,
  systemInstruction: string,
  userPrompt: string,
  apiKey: string,
): Promise<any> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
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
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        const statusError = new Error(
          `Gemini API error (${response.status}): ${errorText}`,
        );

        if (
          isRateLimitError(statusError) ||
          isTransientGeminiError(statusError)
        ) {
          lastError = statusError;
          if (attempt < 3) {
            await sleep(attempt * 600);
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
      if (attempt < 3 && isTransientGeminiError(error)) {
        await sleep(attempt * 600);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Failed direct Gemini call');
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
  try {
    return await operation();
  } catch (error) {
    const shouldFallback =
      isRateLimitError(error) || isTransientGeminiError(error);

    if (!shouldFallback || !fallbackParams) {
      throw error;
    }

    const keys = getGeminiApiKeys();
    if (keys.length === 0) {
      throw error;
    }

    const primary = process.env.GEMINI_API_KEY?.trim();
    const orderedKeys = [
      ...keys.filter((key) => key !== primary),
      ...keys.filter((key) => key === primary),
    ];

    let lastFallbackError: unknown = error;

    for (const key of orderedKeys) {
      try {
        const rawResponse = await callGeminiDirectly(
          'gemini-2.5-flash',
          fallbackParams.systemInstruction,
          fallbackParams.userPrompt,
          key,
        );

        if (fallbackParams.parseResponse) {
          return fallbackParams.parseResponse(rawResponse);
        }

        return rawResponse as T;
      } catch (fallbackError) {
        lastFallbackError = fallbackError;
      }
    }

    throw lastFallbackError;
  }
}
