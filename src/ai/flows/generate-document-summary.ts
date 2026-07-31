'use server';
/**
 * @fileOverview Generate a comprehensive study guide from documents as raw markdown.
 * No JSON wrapping — token-efficient, streaming-friendly.
 */

import { callNimJsonStream } from '@/ai/api';
import { RateLimitPresets, enforceRateLimit } from '@/lib/rate-limit';
import { getCachedSummary, saveSummary } from '@/lib/storage';
import { z } from 'zod';
import crypto from 'crypto';

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

const MAX_DOC_CHARS_PER_DOC = 50000;

function truncateDocuments(docs: { name: string; content: string }[]): { name: string; content: string }[] {
  return docs.map((d) => {
    if (d.content.length <= MAX_DOC_CHARS_PER_DOC) return d;
    return { ...d, content: d.content.slice(0, MAX_DOC_CHARS_PER_DOC) + '\n\n[... document truncated for length ...]' };
  });
}

function docSignature(documents: { name: string; content: string }[], priorityTopics?: { topic: string; frequency?: number }[]): string {
  const docsPart = documents.map((d) => `${d.name}:${d.content.slice(0, 2000)}`).join('||');
  const topicsPart = priorityTopics
    ? priorityTopics.map((t) => `${t.topic}:${t.frequency ?? 0}`).sort().join(',')
    : '';
  return crypto.createHash('sha256').update(docsPart + '|' + topicsPart).digest('hex');
}

const SYSTEM = 'You are an expert study guide creator and exam preparation specialist.';

const USER_PROMPT = (documents: { name: string; content: string }[], priorityTopics?: { topic: string; frequency?: number }[]) => {
  const docsText = documents
    .map((d, i) => `DOCUMENT ${i + 1}: "${d.name}"\n\`\`\`\n${d.content}\n\`\`\``)
    .join('\n\n');

  const hasPriorities = priorityTopics && priorityTopics.length > 0;

  let prompt = `Analyze the provided document${documents.length > 1 ? 's' : ''} and produce a comprehensive, exam-ready study guide in raw markdown.

## Structure
Produce these sections using markdown headings (##, ###):

1. **Course Overview** — Subject, key topics covered, brief description.
2. **Chapter/Topic Breakdowns** — For each major topic:
   - ## heading for the topic name
   - Definition and explanation
   - Key points as bullet lists
   - Sub-topics with clear explanations
   - Formulas/equations with variables defined
   - Worked examples with step-by-step solutions (if applicable)
   - Comparison tables for similar concepts (| Feature | A | B |)
3. **Key Takeaways** — 10-20 of the most important insights as a bullet list. Each takeaway a complete sentence.
4. **Glossary** — 10-20 key terms with definitions. Use **term** — definition format.
${hasPriorities ? `5. **Frequently Tested Topics** — Dedicate extra space to these topics from past exams. Include multiple examples, likely exam questions, and memory aids. Mark these with a 🎯 emoji.` : ''}
${documents.length > 1 ? `6. **Connections & Contrasts** — Identify where topics connect across documents, highlight contradictions or complementary information.` : ''}

## Formatting
- Use ## for sections, ### for sub-sections, #### for sub-sub-sections
- Use tables for comparisons: | Feature | Detail |
- Use **bold** for key terms, > for callouts
- Use \`code\` for formulas
- Use --- to separate major sections

## Tone
- Comprehensive but no fluff
- Exam-oriented — emphasize what students need to know
- Structured — easy to scan and review

${hasPriorities ? `## Priority Topics (Expand in Detail)
${priorityTopics.map((t) => `- ${t.topic}${t.frequency ? ` (appeared ${t.frequency}×)` : ''}`).join('\n')}

Dedicate 2-3× more space to these. Include examples, exam questions, and memory aids for each.` : ''}

Document${documents.length > 1 ? 's' : ''}:
${docsText}

Return ONLY the raw markdown. No JSON, no code fences, no preamble. Start directly with the first ## heading.`;

  return prompt;
};

export async function generateDocumentSummary(input: GenerateDocumentSummaryInput): Promise<string> {
  await enforceRateLimit(RateLimitPresets.summary);

  const sig = docSignature(input.documents, input.priorityTopics);
  const cached = await getCachedSummary(sig);
  if (cached) return cached;

  const truncated = truncateDocuments(input.documents);

  const SUMMARY_TIMEOUT_MS = 120_000;

  const raw = await Promise.race([
    callNimJsonStream(SYSTEM, USER_PROMPT(truncated, input.priorityTopics), {
      maxOutputTokens: 12000,
      skipStripFences: true,
    }),
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("AI_TEMP_UNAVAILABLE: summary generation timed out")), SUMMARY_TIMEOUT_MS),
    ),
  ]);

  saveSummary(sig, raw).catch((err) =>
    console.error("Failed to cache summary:", err),
  );

  return raw;
}
