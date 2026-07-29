'use server';
/**
 * @fileOverview Extract a chapter/topic-focused section from a document.
 */

import { callNimJson } from '@/ai/api';
import { RateLimitPresets, enforceRateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const ExtractTopicSectionInputSchema = z.object({
  documentContent: z.string().describe('The full text content of the study document.'),
  topicFocus: z.string().describe('The user-provided chapter/topic/keyword focus.'),
});
export type ExtractTopicSectionInput = z.infer<typeof ExtractTopicSectionInputSchema>;

const ExtractTopicSectionOutputSchema = z.object({
  extractedText: z.string().describe('The extracted relevant section text. If no match is found, the full original document text.'),
});
export type ExtractTopicSectionOutput = z.infer<typeof ExtractTopicSectionOutputSchema>;

const SYSTEM = 'You are a precise document extraction assistant. Return relevant text verbatim.';

const USER_PROMPT = (input: ExtractTopicSectionInput) =>
  `Read the document and identify the section that best matches the user's requested focus.

Focus request: ${input.topicFocus}

Rules:
- Match chapter numbers, unit names, topic names, and keywords.
- Return the matching section text verbatim from the document.
- Do not summarize or paraphrase.
- If no clear matching section exists, return the full original document unchanged.

Document Content:
\`\`\`
${input.documentContent}
\`\`\`

Return ONLY valid JSON in this exact format with no markdown:
{
  "extractedText": "..."
}`;

export async function extractTopicSection(input: ExtractTopicSectionInput): Promise<ExtractTopicSectionOutput> {
  await enforceRateLimit(RateLimitPresets.extract);
  return callNimJson(SYSTEM, USER_PROMPT(input), (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Failed to parse extract-topic response: ${
          error instanceof Error ? error.message : 'unknown error'
        }. Response preview: ${raw.slice(0, 200)}`,
      );
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof (parsed as { extractedText?: unknown }).extractedText !== 'string'
    ) {
      throw new Error(
        `Missing or invalid "extractedText" field. Response preview: ${raw.slice(0, 200)}`,
      );
    }
    return parsed as ExtractTopicSectionOutput;
  });
}
