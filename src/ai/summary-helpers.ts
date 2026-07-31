/**
 * @fileOverview Pure helpers shared between the summary server action
 * (generate-document-summary.ts) and the streaming route handler
 * (app/api/generate-summary/route.ts). No 'use server' directive here so both
 * callers can import sync functions freely.
 */

import crypto from 'crypto';
import { z } from 'zod';

export const DocumentSchema = z.object({
  name: z.string().describe('The file name of the document.'),
  content: z.string().describe('The full text content of the document.'),
});

export const PriorityTopicSchema = z.object({
  topic: z.string().describe('The topic name.'),
  frequency: z.number().optional().describe('How many past questions mapped to this topic.'),
});

export const GenerateDocumentSummaryInputSchema = z.object({
  documents: z
    .array(DocumentSchema)
    .min(1)
    .describe('The documents to summarize.'),
  priorityTopics: z
    .array(PriorityTopicSchema)
    .optional()
    .describe('Topics from past-question analysis to emphasize in the summary.'),
  forceRegenerate: z
    .boolean()
    .optional()
    .describe('Skip cache and force a fresh generation.'),
});
export type GenerateDocumentSummaryInput = z.infer<typeof GenerateDocumentSummaryInputSchema>;

export const MAX_DOC_CHARS_PER_DOC = 50000;

export function truncateDocuments(docs: { name: string; content: string }[]): { name: string; content: string }[] {
  return docs.map((d) => {
    if (d.content.length <= MAX_DOC_CHARS_PER_DOC) return d;
    return { ...d, content: d.content.slice(0, MAX_DOC_CHARS_PER_DOC) + '\n\n[... document truncated for length ...]' };
  });
}

export function docSignature(documents: { name: string; content: string }[], priorityTopics?: { topic: string; frequency?: number }[]): string {
  const docsPart = documents.map((d) => `${d.name}:${d.content.slice(0, 2000)}`).join('||');
  const topicsPart = priorityTopics
    ? priorityTopics.map((t) => `${t.topic}:${t.frequency ?? 0}`).sort().join(',')
    : '';
  return crypto.createHash('sha256').update(docsPart + '|' + topicsPart).digest('hex');
}

export const SUMMARY_SYSTEM = 'You are an expert study guide creator and exam preparation specialist.';

const HEADING_EXAMPLE = `Example of correct heading formatting:
## Soil Hydrology
### Definition
Soil hydrology is the study of water movement through the soil profile.
### Infiltration
Infiltration is the downward movement of water from the surface into the soil.
#### Capillary Forces
Capillarity draws water upward through small pore spaces against gravity.
### Percolation
Percolation is the deep drainage of water beyond the root zone.`;

export const SUMMARY_USER_PROMPT = (documents: { name: string; content: string }[], priorityTopics?: { topic: string; frequency?: number }[]) => {
  const docsText = documents
    .map((d, i) => `DOCUMENT ${i + 1}: "${d.name}"\n\`\`\`\n${d.content}\n\`\`\``)
    .join('\n\n');

  const hasPriorities = priorityTopics && priorityTopics.length > 0;

  let prompt = `Analyze the provided document${documents.length > 1 ? 's' : ''} and produce a comprehensive, exam-ready study guide in raw markdown.

## Structure
Produce these sections using markdown headings (##, ###, ####):

1. **Course Overview** — Subject, key topics covered, brief description. Use ### sub-headings for each named element.
2. **Chapter/Topic Breakdowns** — For each major topic:
   - ## heading for the major topic name
   - ### heading for every sub-topic (Definition, Explanation, Formula, Force, Classification, Example, etc.)
   - #### heading for sub-sub-topics where needed
   - Bullet lists for key points
   - Formulas/equations with variables defined
   - Comparison tables (| Feature | Detail |)
3. **Key Takeaways** — 10-20 bullet points. Each a complete sentence.
4. **Glossary** — 10-20 **term** — definition pairs.
${hasPriorities ? `5. **Frequently Tested Topics** — Extra detail with 🎯 marker, examples, exam questions, memory aids.` : ''}
${documents.length > 1 ? `6. **Connections & Contrasts** — Cross-document synthesis.` : ''}

## CRITICAL Heading Rules
EVERY topic name, sub-topic name, named force, named classification, named type — anything that introduces a new concept — MUST be its own ### or #### heading line.
- "Definition" → ### Definition
- "Capillary Forces" → #### Capillary Forces
- "Factors Affecting Infiltration" → #### Factors Affecting Infiltration
- "Darcy's Law" → ### Darcy's Law
- "Infiltration" → ### Infiltration
Never present a title as a plain sentence — ALWAYS prefix it with the correct number of #.
A heading line should be short (1-6 words), have no trailing period, and stand alone on its own line.

${HEADING_EXAMPLE}

## Formatting
- ## for major topics, ### for sub-topics, #### for sub-sub-topics
- Tables: | Feature | Detail |
- **bold** for key terms, > for callouts, \`code\` for formulas
- --- to separate major sections

## Tone
Comprehensive but no fluff. Exam-oriented. Easy to scan.

${hasPriorities ? `## Priority Topics (Expand in Detail)
${priorityTopics.map((t) => `- ${t.topic}${t.frequency ? ` (appeared ${t.frequency}×)` : ''}`).join('\n')}

Dedicate 2-3× more space. Include examples, exam questions, memory aids.` : ''}

Document${documents.length > 1 ? 's' : ''}:
${docsText}

Return ONLY raw markdown. No JSON, no code fences, no preamble. Start directly with the first ## heading.`;

  return prompt;
};

export function checkHeadingHealth(markdown: string): void {
  const headingCount = (markdown.match(/^#{2,4}\s/gm) || []).length;
  const lineCount = markdown.split('\n').length;

  if (headingCount < 3) {
    console.warn(
      `[summary] Low heading count: ${headingCount} headings in ~${lineCount} lines. ` +
        `The model may be drifting from heading instructions.`,
    );
  }
}

export function normalizeHeadings(markdown: string): string {
  const lines = markdown.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    const isHeading = trimmed.startsWith('#');
    const isTableRow = trimmed.startsWith('|');
    const isBullet = /^[-*+]\s/.test(trimmed);
    const isNumbered = /^\d+[.)]\s/.test(trimmed);
    const isCodeFence = trimmed.startsWith('```');
    const isBlockquote = trimmed.startsWith('>');
    const isHorizontalRule = /^[-=]{3,}$/.test(trimmed);

    if (!trimmed || isHeading || isTableRow || isBullet || isNumbered || isCodeFence || isBlockquote || isHorizontalRule) {
      result.push(lines[i]);
      continue;
    }

    const precededByBlank = i === 0 || !lines[i - 1].trim();
    const prevIsHeading =
      result.length > 0 && result[result.length - 1].trim().startsWith('#');

    let nextIdx = i + 1;
    while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++;
    const hasBodyAfter = nextIdx < lines.length;

    const words = trimmed.split(/\s+/);
    const looksLikeTitle =
      words.length >= 1 &&
      words.length <= 6 &&
      !trimmed.endsWith('.') &&
      !trimmed.endsWith('?') &&
      !trimmed.endsWith('!') &&
      !trimmed.endsWith(':') &&
      !trimmed.endsWith(',');

    if (looksLikeTitle && (precededByBlank || prevIsHeading) && hasBodyAfter) {
      result.push('### ' + trimmed);
    } else {
      result.push(lines[i]);
    }
  }

  return result.join('\n');
}
