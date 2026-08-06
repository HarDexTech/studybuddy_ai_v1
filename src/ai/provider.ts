import { callNimJson, callNimJsonStream } from "@/ai/api";
import { callGeminiJson, callGeminiJsonStream } from "@/ai/gemini/engine";
import { isRateLimitError, isTransientError } from "@/ai/retry";

// ---------------------------------------------------------------------------
// Provider layer — selects the primary AI backend (default: NIM/DeepSeek) and
// automatically falls back to the other when the primary hits rate limits,
// overload, timeouts, or a temporary outage. Set AI_PROVIDER=gemini to invert.
// ---------------------------------------------------------------------------

export type AiProvider = "nim" | "gemini";

export function getPrimaryProvider(): AiProvider {
  const raw = process.env.AI_PROVIDER?.trim()?.toLowerCase();
  return raw === "gemini" ? "gemini" : "nim";
}

export function otherProvider(provider: AiProvider): AiProvider {
  return provider === "nim" ? "gemini" : "nim";
}

export function shouldFallbackToOtherProvider(error: unknown): boolean {
  return isRateLimitError(error) || isTransientError(error);
}

export interface CallJsonOptions {
  temperature?: number;
  maxOutputTokens?: number;
  thinkingDisabled?: boolean;
  skipStripFences?: boolean;
  timeoutMs?: number;
}

export interface CallJsonStreamOptions extends CallJsonOptions {
  onChunk?: (accumulated: string) => void;
}

function logFailure(provider: AiProvider, fallback: boolean, error: unknown): void {
  const message = error instanceof Error ? error.message.slice(0, 200) : String(error);
  console.warn(
    `[provider] ${provider} failed${fallback ? `, falling back to ${otherProvider(provider)}` : ", giving up"}: ${message}`,
  );
}

export async function callJson<T>(
  systemInstruction: string,
  userPrompt: string,
  parse: (raw: string) => T,
  options: CallJsonOptions = {},
  overrides?: { primary?: AiProvider },
): Promise<T> {
  const primary = overrides?.primary ?? getPrimaryProvider();
  const ordered: AiProvider[] = [primary, otherProvider(primary)];
  let lastError: unknown;

  for (let index = 0; index < ordered.length; index++) {
    const providerName = ordered[index];
    const isLast = index === ordered.length - 1;

    try {
      if (providerName === "gemini") {
        return await callGeminiJson(systemInstruction, userPrompt, parse, options);
      }
      return await callNimJson(systemInstruction, userPrompt, parse, options);
    } catch (error) {
      lastError = error;
      const fallbackEligible = !isLast && shouldFallbackToOtherProvider(error);
      logFailure(providerName, fallbackEligible, error);
      if (isLast || !fallbackEligible) break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("AI call failed after exhausting all providers");
}

export async function callJsonStream(
  systemInstruction: string,
  userPrompt: string,
  options: CallJsonStreamOptions = {},
  overrides?: { primary?: AiProvider },
): Promise<string> {
  const primary = overrides?.primary ?? getPrimaryProvider();
  const ordered: AiProvider[] = [primary, otherProvider(primary)];
  let lastError: unknown;

  for (let index = 0; index < ordered.length; index++) {
    const providerName = ordered[index];
    const isLast = index === ordered.length - 1;

    try {
      if (providerName === "gemini") {
        return await callGeminiJsonStream(systemInstruction, userPrompt, {
          temperature: options.temperature,
          maxOutputTokens: options.maxOutputTokens,
          skipStripFences: options.skipStripFences,
          timeoutMs: options.timeoutMs,
          onChunk: options.onChunk,
        });
      }
      return await callNimJsonStream(systemInstruction, userPrompt, {
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        thinkingDisabled: options.thinkingDisabled,
        skipStripFences: options.skipStripFences,
        timeoutMs: options.timeoutMs,
        onChunk: options.onChunk,
      });
    } catch (error) {
      lastError = error;
      const fallbackEligible = !isLast && shouldFallbackToOtherProvider(error);
      logFailure(providerName, fallbackEligible, error);
      if (isLast || !fallbackEligible) break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("AI stream call failed after exhausting all providers");
}
