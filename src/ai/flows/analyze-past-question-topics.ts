'use server';
/**
 * @fileOverview Analyze past questions against study documents to identify
 * frequently tested topics and extract verbatim-reusable questions.
 */

import { callJson } from '@/ai/provider';
import { RateLimitPresets, enforceRateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const TopicWeightSchema = z.object({
  topic: z.string().describe('The topic name, e.g. "Addition" or "Photosynthesis".'),
  frequency: z.number().describe('How many past questions map to this topic.'),
  matchedSection: z.string().describe('A brief excerpt or section title from the document matching this topic.'),
  exampleQuestions: z.array(z.string()).describe('Up to 3 example past question texts for this topic.'),
});

const AnalyzePastQuestionTopicsInputSchema = z.object({
  documents: z
    .array(z.object({
      name: z.string(),
      content: z.string(),
    }))
    .min(1)
    .describe('The study document(s) to analyze against.'),
  pastQuestionsText: z.string().describe('The full text of past question papers.'),
});
export type AnalyzePastQuestionTopicsInput = z.infer<typeof AnalyzePastQuestionTopicsInputSchema>;

const AnalyzePastQuestionTopicsOutputSchema = z.object({
  topics: z.array(TopicWeightSchema).describe('Ranked topics by frequency.'),
  matchingQuestions: z.array(z.string()).describe('Literal past questions that clearly map to the document content and can be reused verbatim or lightly reworded.'),
});
export type AnalyzePastQuestionTopicsOutput = z.infer<typeof AnalyzePastQuestionTopicsOutputSchema>;

const SYSTEM = 'You are an expert at analyzing past exam questions against study material to identify frequently tested topics.';

const USER_PROMPT = (input: AnalyzePastQuestionTopicsInput) => {
  const docsText = input.documents
    .map((d, i) => `DOCUMENT ${i + 1}: "${d.name}"\n\`\`\`\n${d.content}\n\`\`\``)
    .join('\n\n');

  return `Analyze the past questions below against the provided study document${input.documents.length > 1 ? 's' : ''}.

Documents:
${docsText}

Past Questions:
\`\`\`
${input.pastQuestionsText}
\`\`\`

For each past question, determine:
1. Which topic it tests (map it semantically to a section/chapter in the document).
2. How many questions map to each distinct topic.
3. Which questions could be reused verbatim or lightly reworded because they clearly test content present in the document.

Return ONLY valid JSON with two keys:
- "topics": array of {topic: string, frequency: number, matchedSection: string, exampleQuestions: string[]} sorted by frequency descending.
- "matchingQuestions": array of full question texts that map clearly to the document content and are suitable for reuse.

No markdown.`;
};

export async function analyzePastQuestionTopics(
  input: AnalyzePastQuestionTopicsInput,
): Promise<AnalyzePastQuestionTopicsOutput> {
  await enforceRateLimit(RateLimitPresets.topicAnalysis);
  return callJson(SYSTEM, USER_PROMPT(input), (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Failed to parse topic analysis response: ${
          error instanceof Error ? error.message : 'unknown error'
        }. Response preview: ${raw.slice(0, 200)}`,
      );
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as { topics?: unknown }).topics) ||
      !Array.isArray((parsed as { matchingQuestions?: unknown }).matchingQuestions)
    ) {
      throw new Error(
        `Missing "topics" or "matchingQuestions" arrays. Response preview: ${raw.slice(0, 200)}`,
      );
    }
    return parsed as AnalyzePastQuestionTopicsOutput;
  });
}