import { isRateLimitError } from "./genkit";

// ---------------------------------------------------------------------------
// NVIDIA NIM client — OpenAI-compatible API via fetch
// docs: https://docs.nvidia.com/nim/large-language-models/latest/getting-started.html
// get a key: https://build.nvidia.com/deepseek-ai/deepseek-v4-flash
// ---------------------------------------------------------------------------

const NVIDIA_NIM_API_KEY = process.env.NVIDIA_NIM_API_KEY?.trim() || "";
const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

const MODEL_PRIORITY = [
  "deepseek-ai/deepseek-v4-flash",
  "deepseek-ai/deepseek-v4-pro",
];

const hasKey = NVIDIA_NIM_API_KEY.length > 0;

if (!hasKey) {
  console.warn(
    "[nim] No NVIDIA_NIM_API_KEY set. Add NVIDIA_NIM_API_KEY to .env.",
  );
}

export const hasClients = hasKey;

// ---------------------------------------------------------------------------
// Shared fetch helper
// ---------------------------------------------------------------------------

interface NimMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function nimChat(
  model: string,
  systemInstruction: string,
  userPrompt: string,
  options: { temperature?: number; maxOutputTokens?: number } = {},
): Promise<string> {
  const temperature = options.temperature ?? 0.7;
  const maxOutputTokens = options.maxOutputTokens ?? 4096;

  const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NVIDIA_NIM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: maxOutputTokens,
      stream: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `NIM API error: ${res.status} ${res.statusText}. ${body.slice(0, 300)}`,
    );
    (err as any).status = res.status;
    throw err;
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content;
  if (!text?.trim()) {
    throw new Error("AI_TEMP_UNAVAILABLE: NIM returned empty response.");
  }
  return text.trim();
}

async function nimChatStream(
  model: string,
  systemInstruction: string,
  userPrompt: string,
  options: {
    temperature?: number;
    maxOutputTokens?: number;
    onChunk?: (text: string) => void;
  } = {},
): Promise<string> {
  const temperature = options.temperature ?? 0.7;
  const maxOutputTokens = options.maxOutputTokens ?? 4096;

  const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NVIDIA_NIM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: maxOutputTokens,
      stream: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `NIM API error: ${res.status} ${res.statusText}. ${body.slice(0, 300)}`,
    );
    (err as any).status = res.status;
    throw err;
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body for streaming.");

  const decoder = new TextDecoder();
  let full = "";
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
        if (payload === "[DONE]") break;
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            options.onChunk?.(full);
          }
        } catch {
          // skip malformed SSE chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!full.trim()) {
    throw new Error("AI_TEMP_UNAVAILABLE: NIM returned empty response.");
  }

  return full.trim();
}

// ---------------------------------------------------------------------------
// Public API — `callNimJson` (non-streaming, parse-then-return)
// ---------------------------------------------------------------------------

export interface CallNimJsonOptions {
  temperature?: number;
  maxOutputTokens?: number;
}

export async function callNimJson<T>(
  systemInstruction: string,
  userPrompt: string,
  parse: (raw: string) => T,
  options: CallNimJsonOptions = {},
): Promise<T> {
  if (!hasKey) {
    throw new Error(
      "AI_TEMP_UNAVAILABLE: No NIM API key configured. " +
        "Set NVIDIA_NIM_API_KEY in .env.",
    );
  }

  let lastError: unknown = null;

  for (const modelName of MODEL_PRIORITY) {
    try {
      const text = await nimChat(modelName, systemInstruction, userPrompt, options);
      const cleaned = stripCodeFences(text).trim();
      return parse(cleaned);
    } catch (error) {
      lastError = error;
      console.warn(
        `[nim] model=${modelName} failed: ${error instanceof Error ? error.message.slice(0, 200) : error}`,
      );
      if (isRateLimitError(error)) {
        throw error;
      }
    }
  }

  const lastMsg =
    lastError instanceof Error ? lastError.message : String(lastError ?? "unknown");

  throw new Error(
    `AI_TEMP_UNAVAILABLE: all NIM attempts failed. last="${lastMsg}". ` +
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
}

export async function callNimJsonStream(
  systemInstruction: string,
  userPrompt: string,
  options: CallNimJsonStreamOptions = {},
): Promise<string> {
  if (!hasKey) {
    throw new Error(
      "AI_TEMP_UNAVAILABLE: No NIM API key configured. " +
        "Set NVIDIA_NIM_API_KEY in .env.",
    );
  }

  let lastError: unknown = null;

  for (const modelName of MODEL_PRIORITY) {
    try {
      return await nimChatStream(modelName, systemInstruction, userPrompt, {
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        onChunk: options.onChunk,
      });
    } catch (error) {
      lastError = error;
      console.warn(
        `[nim] model=${modelName} stream failed: ${error instanceof Error ? error.message.slice(0, 200) : error}`,
      );
      if (isRateLimitError(error)) {
        throw error;
      }
    }
  }

  const lastMsg =
    lastError instanceof Error ? lastError.message : String(lastError ?? "unknown");

  throw new Error(
    `AI_TEMP_UNAVAILABLE: all NIM streaming attempts failed. last="${lastMsg}". ` +
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
