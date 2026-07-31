import { isRateLimitError } from "./genkit";

// ---------------------------------------------------------------------------
// DeepSeek client — OpenAI-compatible API via fetch
// Get a key at https://platform.deepseek.com/api_keys
// ---------------------------------------------------------------------------

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY?.trim() || "";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

export const MODEL_PRIORITY = ["deepseek-v4-flash"];

const hasKey = DEEPSEEK_API_KEY.length > 0;

if (!hasKey) {
  console.warn(
    "[deepseek] No DEEPSEEK_API_KEY set. Add DEEPSEEK_API_KEY to .env.",
  );
}

export const hasClients = hasKey;

// ---------------------------------------------------------------------------
// Shared fetch helper
// ---------------------------------------------------------------------------

interface DeepSeekMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function deepseekChat(
  model: string,
  systemInstruction: string,
  userPrompt: string,
  options: { temperature?: number; maxOutputTokens?: number; thinkingDisabled?: boolean } = {},
): Promise<string> {
  const temperature = options.temperature ?? 0.7;
  const maxOutputTokens = options.maxOutputTokens ?? 4096;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: userPrompt },
    ],
    temperature,
    max_tokens: maxOutputTokens,
    stream: false,
  };

  if (options.thinkingDisabled) {
    body.thinking = { type: "disabled" };
  }

  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `DeepSeek API error: ${res.status} ${res.statusText}. ${body.slice(0, 300)}`,
    );
    (err as any).status = res.status;
    throw err;
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content;
  if (!text?.trim()) {
    const reason = json.choices?.[0]?.finish_reason ?? "unknown";
    const reasoningLen = (json.choices?.[0]?.message?.reasoning_content as string)?.length ?? 0;
    throw new Error(
      `AI_TEMP_UNAVAILABLE: DeepSeek returned empty response. ` +
        `finish_reason="${reason}" reasoning_content_length=${reasoningLen}. ` +
        `model="${model}" max_tokens=${maxOutputTokens}.`,
    );
  }
  return text.trim();
}

// ---------------------------------------------------------------------------
// Shared streaming SSE helper
//
// Used both by `deepseekChatStream` (accumulate + return) and by route handlers
// that need to pipe deltas straight through to the client.
// ---------------------------------------------------------------------------

export interface DeepSeekStreamDelta {
  content?: string;
  reasoningContent?: string;
  finishReason?: string;
}

export async function* deepseekChatStreamChunks(
  model: string,
  systemInstruction: string,
  userPrompt: string,
  options: {
    temperature?: number;
    maxOutputTokens?: number;
    thinkingDisabled?: boolean;
  } = {},
): AsyncGenerator<DeepSeekStreamDelta, void, void> {
  const temperature = options.temperature ?? 0.7;
  const maxOutputTokens = options.maxOutputTokens ?? 4096;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: userPrompt },
    ],
    temperature,
    max_tokens: maxOutputTokens,
    stream: true,
  };

  if (options.thinkingDisabled) {
    body.thinking = { type: "disabled" };
  }

  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `DeepSeek API error: ${res.status} ${res.statusText}. ${body.slice(0, 300)}`,
    );
    (err as any).status = res.status;
    throw err;
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body for streaming.");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") return;
        try {
          const chunk = JSON.parse(payload);
          const delta: DeepSeekStreamDelta = {};
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) delta.content = content;
          const rdelta = chunk.choices?.[0]?.delta?.reasoning_content;
          if (rdelta) delta.reasoningContent = rdelta;
          const fr = chunk.choices?.[0]?.finish_reason;
          if (fr) delta.finishReason = fr;
          yield delta;
        } catch {
          // skip malformed SSE chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function deepseekChatStream(
  model: string,
  systemInstruction: string,
  userPrompt: string,
  options: {
    temperature?: number;
    maxOutputTokens?: number;
    onChunk?: (text: string) => void;
    thinkingDisabled?: boolean;
  } = {},
): Promise<string> {
  const maxOutputTokens = options.maxOutputTokens ?? 4096;

  let full = "";
  let reasoning = "";
  let lastFinishReason = "";

  for await (const delta of deepseekChatStreamChunks(model, systemInstruction, userPrompt, {
    temperature: options.temperature,
    maxOutputTokens,
    thinkingDisabled: options.thinkingDisabled,
  })) {
    if (delta.content) {
      full += delta.content;
      options.onChunk?.(full);
    }
    if (delta.reasoningContent) reasoning += delta.reasoningContent;
    if (delta.finishReason) lastFinishReason = delta.finishReason;
  }

  if (!full.trim()) {
    throw new Error(
      `AI_TEMP_UNAVAILABLE: DeepSeek returned empty response. ` +
        `finish_reason="${lastFinishReason || 'none'}" reasoning_content_length=${reasoning.length}. ` +
        `model="${model}" max_tokens=${maxOutputTokens}.`,
    );
  }

  return full.trim();
}

// ---------------------------------------------------------------------------
// Public API — `callNimJson` (non-streaming, parse-then-return)
// ---------------------------------------------------------------------------

export interface CallNimJsonOptions {
  temperature?: number;
  maxOutputTokens?: number;
  thinkingDisabled?: boolean;
}

export async function callNimJson<T>(
  systemInstruction: string,
  userPrompt: string,
  parse: (raw: string) => T,
  options: CallNimJsonOptions = {},
): Promise<T> {
  if (!hasKey) {
    throw new Error(
      "AI_TEMP_UNAVAILABLE: No DeepSeek API key configured. " +
        "Set DEEPSEEK_API_KEY in .env.",
    );
  }

  let lastError: unknown = null;

  for (const modelName of MODEL_PRIORITY) {
    try {
      const text = await deepseekChat(modelName, systemInstruction, userPrompt, options);
      const cleaned = stripCodeFences(text).trim();
      return parse(cleaned);
    } catch (error) {
      lastError = error;
      console.warn(
        `[deepseek] model=${modelName} failed: ${error instanceof Error ? error.message.slice(0, 200) : error}`,
      );
      if (isRateLimitError(error)) {
        throw error;
      }
    }
  }

  const lastMsg =
    lastError instanceof Error ? lastError.message : String(lastError ?? "unknown");

  throw new Error(
    `AI_TEMP_UNAVAILABLE: all DeepSeek attempts failed. last="${lastMsg}". ` +
      `models=[${MODEL_PRIORITY.join(",")}]`,
  );
}

// ---------------------------------------------------------------------------
// Streaming variant
// ---------------------------------------------------------------------------

export interface CallNimJsonStreamOptions {
  temperature?: number;
  maxOutputTokens?: number;
  onChunk?: (accumulated: string) => void;
  skipStripFences?: boolean;
  thinkingDisabled?: boolean;
}

export async function callNimJsonStream(
  systemInstruction: string,
  userPrompt: string,
  options: CallNimJsonStreamOptions = {},
): Promise<string> {
  if (!hasKey) {
    throw new Error(
      "AI_TEMP_UNAVAILABLE: No DeepSeek API key configured. " +
        "Set DEEPSEEK_API_KEY in .env.",
    );
  }

  let lastError: unknown = null;

  for (const modelName of MODEL_PRIORITY) {
    try {
      const text = await deepseekChatStream(modelName, systemInstruction, userPrompt, {
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        onChunk: options.onChunk,
        thinkingDisabled: options.thinkingDisabled,
      });
      return options.skipStripFences ? text.trim() : stripCodeFences(text).trim();
    } catch (error) {
      lastError = error;
      console.warn(
        `[deepseek] model=${modelName} stream failed: ${error instanceof Error ? error.message.slice(0, 200) : error}`,
      );
      if (isRateLimitError(error)) {
        throw error;
      }
    }
  }

  const lastMsg =
    lastError instanceof Error ? lastError.message : String(lastError ?? "unknown");

  throw new Error(
    `AI_TEMP_UNAVAILABLE: all DeepSeek streaming attempts failed. last="${lastMsg}". ` +
      `models=[${MODEL_PRIORITY.join(",")}]`,
  );
}

// ---------------------------------------------------------------------------
// JSON extraction helper
// ---------------------------------------------------------------------------

export function stripCodeFences(raw: string): string {
  let cleaned = raw;

  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    cleaned = fenceMatch[1];
  }

  cleaned = cleaned.replace(/```json\n?/gi, "").replace(/```\n?/gi, "");

  const firstBrace = cleaned.search(/[{[]/);
  if (firstBrace > 0) {
    cleaned = cleaned.slice(firstBrace);
  }
  const lastBrace = Math.max(
    cleaned.lastIndexOf("}"),
    cleaned.lastIndexOf("]"),
  );
  if (lastBrace > 0 && lastBrace < cleaned.length - 1) {
    cleaned = cleaned.slice(0, lastBrace + 1);
  }

  return cleaned;
}
