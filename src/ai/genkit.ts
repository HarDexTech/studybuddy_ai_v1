import { z } from "zod";

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS_CODES = new Set([
  408, 409, 425, 429, 500, 502, 503, 504,
]);

export function isRateLimitError(error: unknown): boolean {
  const text = extractErrorText(error);
  if (
    text.includes("429") ||
    text.includes("rate limit") ||
    text.includes("rate_limit") ||
    text.includes("quota") ||
    text.includes("resource exhausted") ||
    text.includes("too many attempts") ||
    text.includes("too many requests")
  )
    return true;
  const status = extractHttpStatus(error);
  return status === 429;
}

export function isTransientError(error: unknown): boolean {
  const text = extractErrorText(error);
  if (
    text.includes("ai_temp_unavailable") ||
    text.includes("fetch failed") ||
    text.includes("econnreset") ||
    text.includes("etimedout") ||
    text.includes("timed out") ||
    text.includes("timeout") ||
    text.includes("eai_again") ||
    text.includes("enotfound") ||
    text.includes("service unavailable") ||
    text.includes("bad gateway") ||
    text.includes("gateway timeout") ||
    text.includes("overloaded")
  ) {
    return true;
  }
  const status = extractHttpStatus(error);
  return status !== null && RETRYABLE_STATUS_CODES.has(status);
}

function extractErrorText(error: unknown): string {
  const message = (error as { message?: unknown })?.message;
  return `${message ?? ""} ${String(error ?? "")}`.toLowerCase();
}

function extractHttpStatus(error: unknown): number | null {
  const obj = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  const candidate = obj?.status ?? obj?.statusCode ?? obj?.response?.status;
  return typeof candidate === "number" ? candidate : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 4000;
const GLOBAL_TIMEOUT_MS = 90000;

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    timeoutMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const timeoutMs = options.timeoutMs ?? GLOBAL_TIMEOUT_MS;
  const shouldRetry =
    options.shouldRetry ??
    ((error: unknown) => isTransientError(error) || isRateLimitError(error));

  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (Date.now() - startedAt >= timeoutMs) {
      break;
    }

    const remainingBudget = timeoutMs - (Date.now() - startedAt);
    const callTimeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("AI_TEMP_UNAVAILABLE: model call timed out")),
        Math.max(remainingBudget, 1000),
      );
    });

    try {
      return await Promise.race([operation(), callTimeout]);
    } catch (error) {
      lastError = error;

      const within = Date.now() - startedAt < timeoutMs;
      const retryable = shouldRetry(error);
      if (attempt >= maxAttempts || !within || !retryable) {
        throw error;
      }

      const base = Math.min(
        initialDelayMs * Math.pow(2, attempt - 1),
        maxDelayMs,
      );
      const delay = Math.floor(Math.random() * (base + 1));
      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("AI call failed after all retries");
}
