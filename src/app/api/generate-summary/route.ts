import { NextRequest } from "next/server";
import { MODEL_PRIORITY, deepseekChatStreamChunks } from "@/ai/api";
import { callGeminiJson } from "@/ai/gemini/engine";
import {
  getPrimaryProvider,
  otherProvider,
  shouldFallbackToOtherProvider,
  type AiProvider,
} from "@/ai/provider";
import { withRetry } from "@/ai/retry";
import {
  SUMMARY_SYSTEM,
  SUMMARY_USER_PROMPT,
  checkHeadingHealth,
  docSignature,
  normalizeHeadings,
  truncateDocuments,
} from "@/ai/summary-helpers";
import { RateLimitPresets, enforceRateLimit } from "@/lib/rate-limit";
import { getCachedSummary, saveSummary } from "@/lib/storage";
import { getMultipleRecentDocuments } from "@/lib/storage";
import { retrieveTestContext } from "@/ai/rag";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 120;

const SUMMARY_MAX_OUTPUT_TOKENS = 12000;
const SummaryRequestSchema = z.object({
  documents: z.array(z.object({ id: z.string().trim().min(1) })).min(1),
  priorityTopics: z
    .array(z.object({ topic: z.string(), frequency: z.number().optional() }))
    .optional(),
  forceRegenerate: z.boolean().optional(),
});

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

  let documents: { name: string; content: string; structuredText?: string }[];
  let documentIds: string[];
  let priorityTopics: { topic: string; frequency?: number }[] | undefined;
  let forceRegenerate: boolean | undefined;

  try {
    const body = await request.json();
    const parsed = SummaryRequestSchema.parse(body);
    documentIds = parsed.documents.map((document) => document.id).filter(Boolean);
    if (documentIds.length !== parsed.documents.length) {
      throw new Error("DOCUMENT_IDS_REQUIRED");
    }
    const authorizedDocuments = await getMultipleRecentDocuments(documentIds);
    if (authorizedDocuments.length !== documentIds.length) {
      throw new Error("DOCUMENT_ACCESS_DENIED");
    }
    documents = await Promise.all(
      authorizedDocuments.map(async (document, index) => ({
        name: document.name,
        content: await retrieveTestContext(
          "key concepts definitions principles facts examples",
          { docId: documentIds[index], limit: 20 },
        ),
        structuredText: document.structuredText,
      })),
    );
    if (documents.some((document) => !document.content)) {
      throw new Error("DOCUMENT_CONTEXT_UNAVAILABLE");
    }
    priorityTopics = parsed.priorityTopics;
    forceRegenerate = parsed.forceRegenerate;
  } catch (error) {
    const message = error instanceof Error ? error.message : "INVALID_INPUT";
    return Response.json(
      {
        error: message.startsWith("DOCUMENT_")
          ? message
          : "INVALID_INPUT: document IDs are required.",
      },
      { status: message === "DOCUMENT_ACCESS_DENIED" ? 403 : 400 },
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const primary = getPrimaryProvider();
        const providers: AiProvider[] = [primary, otherProvider(primary)];

        for (let index = 0; index < providers.length; index++) {
          const providerName = providers[index];
          const isLast = index === providers.length - 1;

          try {
            let raw: string;

            if (providerName === "gemini") {
              raw = await callGeminiJson(
                SUMMARY_SYSTEM,
                SUMMARY_USER_PROMPT(truncated, priorityTopics),
                (text) => text,
                {
                  maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
                },
              );
            } else {
              const model = MODEL_PRIORITY[0];
              raw = await withRetry(async () => {
                let buf = "";
                for await (const delta of deepseekChatStreamChunks(
                  model,
                  SUMMARY_SYSTEM,
                  SUMMARY_USER_PROMPT(truncated, priorityTopics),
                  {
                    maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
                    thinkingDisabled: true,
                  },
                )) {
                  if (delta.content) buf += delta.content;
                }
                if (!buf.trim()) {
                  throw new Error(
                    "AI_TEMP_UNAVAILABLE: DeepSeek returned empty response.",
                  );
                }
                return buf;
              });
            }

            const cleaned = normalizeHeadings(raw);
            checkHeadingHealth(cleaned);
            saveSummary(sig, cleaned).catch((err) =>
              console.error("Failed to cache summary:", err),
            );

            controller.enqueue(encoder.encode(cleaned));
            controller.close();
            return;
          } catch (error) {
            const fallbackEligible = !isLast && shouldFallbackToOtherProvider(error);
            console.warn(
              `[provider] ${providerName} summary failed${fallbackEligible ? ", falling back" : ""}: ${error instanceof Error ? error.message.slice(0, 200) : error}`,
            );
            if (isLast || !fallbackEligible) throw error;
          }
        }
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
