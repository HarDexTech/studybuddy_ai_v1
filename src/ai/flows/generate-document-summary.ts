'use server';
/**
 * @fileOverview Generate chapter summaries, key takeaways, and glossary from one or more documents.
 */

import { callNimJsonStream } from '@/ai/api';
import { RateLimitPresets, enforceRateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const DocumentSchema = z.object({
  name: z.string().describe('The file name of the document.'),
  content: z.string().describe('The full text content of the document.'),
});

const PriorityTopicSchema = z.object({
  topic: z.string().describe('The topic name.'),
  frequency: z.number().optional().describe('How many past questions mapped to this topic.'),
});

const GenerateDocumentSummaryInputSchema = z.object({
  documents: z
    .array(DocumentSchema)
    .min(1)
    .describe('The documents to summarize.'),
  priorityTopics: z
    .array(PriorityTopicSchema)
    .optional()
    .describe('Topics from past-question analysis to emphasize in the summary.'),
});
export type GenerateDocumentSummaryInput = z.infer<typeof GenerateDocumentSummaryInputSchema>;

const ChapterSummarySchema = z.object({
  title: z.string().describe('The title of the chapter or section.'),
  summary: z.string().describe('A concise summary of the chapter.'),
  sourceDoc: z.string().optional().describe('Which document(s) this chapter originated from.'),
});

const GlossaryTermSchema = z.object({
  term: z.string().describe('A key term from the document.'),
  definition: z.string().describe('The definition of the term.'),
  sourceDoc: z.string().optional().describe('Which document(s) this term originated from.'),
});

const ExamFocusTopicSchema = z.object({
  topic: z.string().describe('The topic name frequently tested in past questions.'),
  frequency: z.number().optional().describe('How many past questions mapped to this topic.'),
  note: z.string().describe('A brief note about how this topic appears in the document.'),
});

const GenerateDocumentSummaryOutputSchema = z.object({
  chapterSummaries: z.array(ChapterSummarySchema).describe('Summaries of each chapter or section.'),
  keyTakeaways: z.array(z.string()).describe('The most important takeaways from the document(s).'),
  glossary: z.array(GlossaryTermSchema).describe('Key terms and their definitions.'),
  examFocusTopics: z.array(ExamFocusTopicSchema).optional().describe('Topics frequently tested in past questions.'),
});
export type GenerateDocumentSummaryOutput = z.infer<typeof GenerateDocumentSummaryOutputSchema>;

const MAX_DOC_CHARS_PER_DOC = 50000;

function truncateDocuments(docs: { name: string; content: string }[]): { name: string; content: string }[] {
  return docs.map((d) => {
    if (d.content.length <= MAX_DOC_CHARS_PER_DOC) return d;
    return { ...d, content: d.content.slice(0, MAX_DOC_CHARS_PER_DOC) + '\n\n[... document truncated for length ...]' };
  });
}

const SYSTEM = 'You are an expert study assistant that creates comprehensive document summaries.';

const USER_PROMPT = (documents: { name: string; content: string }[], priorityTopics?: { topic: string; frequency?: number }[]) => {
  const docsText = documents
    .map((d, i) => `DOCUMENT ${i + 1}: "${d.name}"\n\`\`\`\n${d.content}\n\`\`\``)
    .join('\n\n');

  let basePrompt = `Analyze the provided document${documents.length > 1 ? 's' : ''} and produce:

1. **Chapter Summaries** — Break the content into logical sections/chapters. For each section, provide a concise summary (2-4 sentences) capturing the core content. ${documents.length > 1 ? 'Include a "sourceDoc" field indicating which document the chapter came from.' : ''}
2. **Key Takeaways** — Extract 5-10 of the most important insights, facts, or concepts from across the entire content. Each takeaway should be a single clear sentence.
3. **Glossary** — Identify 5-15 key technical terms, acronyms, or important concepts with clear definitions. ${documents.length > 1 ? 'Include a "sourceDoc" field indicating which document the term came from.' : ''}
4. **Exam Focus Topics** — Identify which topics from the provided list appear in the document and where.

${documents.length > 1 ? 'Synthesize connections and contrasts between the documents where relevant.' : ''}

Document${documents.length > 1 ? 's' : ''}:
${docsText}`;

  if (priorityTopics && priorityTopics.length > 0) {
    const topicsText = priorityTopics
      .map((t) => `- ${t.topic}${t.frequency ? ` (appeared ${t.frequency} times in past questions)` : ''}`)
      .join('\n');
    basePrompt += `

Priority Topics (frequently tested in past questions — expand summaries/takeaways for these):
${topicsText}`;
  }

  basePrompt += `

Return ONLY valid JSON with four keys: chapterSummaries (array of {title, summary${documents.length > 1 ? ', sourceDoc' : ''}}), keyTakeaways (array of strings), glossary (array of {term, definition${documents.length > 1 ? ', sourceDoc' : ''}}), and examFocusTopics (array of {topic, frequency, note}). No markdown.`;

  return basePrompt;
};

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
  const truncated = truncateDocuments(input.documents);

  const raw = await callNimJsonStream(SYSTEM, USER_PROMPT(truncated, input.priorityTopics), {
    maxOutputTokens: 12000,
  });

  const cleaned = stripCodeFences(raw).trim();
  return parseSummaryJson(cleaned);
}