import { NextRequest } from "next/server";
import { MODEL_PRIORITY, deepseekChatStreamChunks } from "@/ai/api";
import {
  GenerateDocumentSummaryInputSchema,
  SUMMARY_SYSTEM,
  SUMMARY_USER_PROMPT,
  checkHeadingHealth,
  docSignature,
  normalizeHeadings,
  truncateDocuments,
} from "@/ai/summary-helpers";
import { RateLimitPresets, enforceRateLimit } from "@/lib/rate-limit";
import { getCachedSummary, saveSummary } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 120;

const SUMMARY_MAX_OUTPUT_TOKENS = 12000;

function streamText(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit(RateLimitPresets.summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "RATE_LIMITED";
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 429;
    return Response.json({ error: message }, { status });
  }

  let documents: { name: string; content: string }[];
  let priorityTopics: { topic: string; frequency?: number }[] | undefined;
  let forceRegenerate: boolean | undefined;

  try {
    const body = await request.json();
    const parsed = GenerateDocumentSummaryInputSchema.parse(body);
    documents = parsed.documents;
    priorityTopics = parsed.priorityTopics;
    forceRegenerate = parsed.forceRegenerate;
  } catch {
    return Response.json(
      {
        error:
          "INVALID_INPUT: documents must contain at least one { name, content } entry.",
      },
      { status: 400 },
    );
  }

  const sig = docSignature(documents, priorityTopics);
  if (!forceRegenerate) {
    const cached = await getCachedSummary(sig);
    if (cached) {
      return streamText(cached);
    }
  }

  const truncated = truncateDocuments(documents);
  const model = MODEL_PRIORITY[0];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      let lastFinishReason = "";
      let reasoningLen = 0;
      try {
        for await (const delta of deepseekChatStreamChunks(
          model,
          SUMMARY_SYSTEM,
          SUMMARY_USER_PROMPT(truncated, priorityTopics),
          {
            maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
            thinkingDisabled: true,
          },
        )) {
          if (delta.content) {
            full += delta.content;
            controller.enqueue(encoder.encode(delta.content));
          }
          if (delta.reasoningContent) reasoningLen += delta.reasoningContent.length;
          if (delta.finishReason) lastFinishReason = delta.finishReason;
        }

        if (!full.trim()) {
          throw new Error(
            `AI_TEMP_UNAVAILABLE: DeepSeek returned empty response. ` +
              `finish_reason="${lastFinishReason || 'none'}" reasoning_content_length=${reasoningLen}. ` +
              `model="${model}" max_tokens=${SUMMARY_MAX_OUTPUT_TOKENS}.`,
          );
        }

        const cleaned = normalizeHeadings(full);
        checkHeadingHealth(cleaned);
        saveSummary(sig, cleaned).catch((err) =>
          console.error("Failed to cache summary:", err),
        );
        controller.close();
      } catch (error) {
        console.error("[generate-summary] streaming failed:", error);
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
