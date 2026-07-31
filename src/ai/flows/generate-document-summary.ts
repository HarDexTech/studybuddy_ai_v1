'use server';
/**
 * @fileOverview Generate a comprehensive study guide from documents as raw markdown.
 * No JSON wrapping — token-efficient, streaming-friendly.
 * This server action is used by the preemptive background generation in
 * storage.ts; the interactive UI streams from /api/generate-summary instead.
 */

import { callNimJsonStream } from '@/ai/api';
import { RateLimitPresets, enforceRateLimit } from '@/lib/rate-limit';
import { getCachedSummary, saveSummary } from '@/lib/storage';
import {
  SUMMARY_SYSTEM,
  SUMMARY_USER_PROMPT,
  checkHeadingHealth,
  docSignature,
  normalizeHeadings,
  truncateDocuments,
  type GenerateDocumentSummaryInput,
} from '@/ai/summary-helpers';

const SUMMARY_TIMEOUT_MS = 120_000;

export async function generateDocumentSummary(input: GenerateDocumentSummaryInput): Promise<string> {
  await enforceRateLimit(RateLimitPresets.summary);

  const sig = docSignature(input.documents, input.priorityTopics);
  const cached = input.forceRegenerate ? null : await getCachedSummary(sig);
  if (cached) return cached;

  const truncated = truncateDocuments(input.documents);

  const raw = await Promise.race([
    callNimJsonStream(SUMMARY_SYSTEM, SUMMARY_USER_PROMPT(truncated, input.priorityTopics), {
      maxOutputTokens: 12000,
      skipStripFences: true,
      thinkingDisabled: true,
    }),
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("AI_TEMP_UNAVAILABLE: summary generation timed out")), SUMMARY_TIMEOUT_MS),
    ),
  ]);

  const cleaned = normalizeHeadings(raw);
  checkHeadingHealth(cleaned);

  saveSummary(sig, cleaned).catch((err) =>
    console.error("Failed to cache summary:", err),
  );

  return cleaned;
}
