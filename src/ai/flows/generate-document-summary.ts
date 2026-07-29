'use server';
/**
 * @fileOverview Generate chapter summaries, key takeaways, and glossary from a document.
 */

import { callNimJsonStream } from '@/ai/api';
import { RateLimitPresets, enforceRateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const GenerateDocumentSummaryInputSchema = z.object({
  documentContent: z.string().describe('The full text content of the study document.'),
});
export type GenerateDocumentSummaryInput = z.infer<typeof GenerateDocumentSummaryInputSchema>;

const ChapterSummarySchema = z.object({
  title: z.string().describe('The title of the chapter or section.'),
  summary: z.string().describe('A concise summary of the chapter.'),
});

const GlossaryTermSchema = z.object({
  term: z.string().describe('A key term from the document.'),
  definition: z.string().describe('The definition of the term.'),
});

const GenerateDocumentSummaryOutputSchema = z.object({
  chapterSummaries: z.array(ChapterSummarySchema).describe('Summaries of each chapter or section.'),
  keyTakeaways: z.array(z.string()).describe('The most important takeaways from the document.'),
  glossary: z.array(GlossaryTermSchema).describe('Key terms and their definitions.'),
});
export type GenerateDocumentSummaryOutput = z.infer<typeof GenerateDocumentSummaryOutputSchema>;

const MAX_DOC_CHARS = 50000;

function truncateDocument(text: string): string {
  if (text.length <= MAX_DOC_CHARS) return text;
  return text.slice(0, MAX_DOC_CHARS) + '\n\n[... document truncated for length ...]';
}

const SYSTEM = 'You are an expert study assistant that creates comprehensive document summaries.';

const USER_PROMPT = (documentContent: string) =>
  `Analyze the provided document and produce:

1. **Chapter Summaries** — Break the document into logical sections/chapters. For each section, provide a concise summary (2-4 sentences) capturing the core content.
2. **Key Takeaways** — Extract 5-10 of the most important insights, facts, or concepts from the entire document. Each takeaway should be a single clear sentence.
3. **Glossary** — Identify 5-15 key technical terms, acronyms, or important concepts from the document with clear definitions.

Document Content:
\`\`\`
${documentContent}
\`\`\`

Return ONLY valid JSON with three keys: chapterSummaries (array of {title, summary}), keyTakeaways (array of strings), and glossary (array of {term, definition}). No markdown.`;

function stripCodeFences(raw: string): string {
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

function parseSummaryJson(raw: string): GenerateDocumentSummaryOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse summary response: ${
        error instanceof Error ? error.message : 'unknown error'
      }. Response preview: ${raw.slice(0, 200)}`,
    );
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { chapterSummaries?: unknown }).chapterSummaries) ||
    !Array.isArray((parsed as { keyTakeaways?: unknown }).keyTakeaways) ||
    !Array.isArray((parsed as { glossary?: unknown }).glossary)
  ) {
    throw new Error(
      `Missing chapterSummaries/keyTakeaways/glossary arrays. Response preview: ${raw.slice(0, 200)}`,
    );
  }
  return parsed as GenerateDocumentSummaryOutput;
}

export async function generateDocumentSummary(input: GenerateDocumentSummaryInput): Promise<GenerateDocumentSummaryOutput> {
  await enforceRateLimit(RateLimitPresets.summary);
  const truncatedContent = truncateDocument(input.documentContent);

  const raw = await callNimJsonStream(SYSTEM, USER_PROMPT(truncatedContent), {
    maxOutputTokens: 12000,
  });

  const cleaned = stripCodeFences(raw).trim();
  return parseSummaryJson(cleaned);
}
