'use server';
/**
 * @fileOverview Generate multiple test questions in a single API call — streaming for lower latency.
 */

import { callJsonStream } from '@/ai/provider';
import { RateLimitPresets, enforceRateLimit } from '@/lib/rate-limit';
import { shuffleMultipleChoiceChoices } from '@/lib/utils';
import { z } from 'zod';

const GenerateBatchTestQuestionsInputSchema = z.object({
  documentContent: z.string().describe('The text content of the study document.'),
  questionTypes: z
    .array(z.enum(['multiple choice', 'fill-in-the-blank', 'theory', 'true or false']))
    .min(1)
    .describe('The selected question types to generate.'),
  difficulty: z.enum(['easy', 'medium', 'hard']).describe('The difficulty level.'),
  questionSource: z.enum(['strict', 'formed']).describe('The source of the questions.'),
  existingQuestions: z.array(z.string()).describe('Already generated questions to avoid duplicates.'),
  batchSize: z.number().default(2).describe('Number of questions to generate (default 2)'),
  priorityTopics: z.array(z.string()).optional().describe('Topics to prioritize / bias questions toward.'),
  seedQuestions: z.array(z.string()).optional().describe('Past questions to reuse verbatim or lightly reworded.'),
});
export type GenerateBatchTestQuestionsInput = z.infer<typeof GenerateBatchTestQuestionsInputSchema>;

type RawQuestion = {
  type?: unknown;
  question?: unknown;
  choices?: unknown;
  correctAnswer?: unknown;
  sourceDoc?: unknown;
};

const SingleQuestionSchema = z.object({
  type: z.enum(['multiple choice', 'fill-in-the-blank', 'theory', 'true or false']).describe('The type of question.'),
  question: z.string().describe('The question text.'),
  choices: z.array(z.string()).optional().describe('The possible answers for multiple choice.'),
  correctAnswer: z.union([z.string(), z.boolean()]).optional().describe('The correct answer.'),
});

const GenerateBatchTestQuestionsOutputSchema = z.object({
  questions: z.array(SingleQuestionSchema).describe('Array of generated questions'),
});
export type GenerateBatchTestQuestionsOutput = z.infer<typeof GenerateBatchTestQuestionsOutputSchema>;

const SYSTEM = 'You are an expert test generator that creates high-quality test questions from uploaded documents.';

const USER_PROMPT = (input: GenerateBatchTestQuestionsInput) => {
  const isStrict = input.questionSource === 'strict';
  const isMultiType = input.questionTypes.length > 1;
  const selectedType = input.questionTypes[0];
  const selectedTypesText = input.questionTypes.map((type) => `"${type}"`).join(', ');
  const existingQuestionsText = input.existingQuestions.length > 0 ? input.existingQuestions.map((q) => `- ${q}`).join('\n') : '- (none yet)';

  let prompt = `Your main instruction is to generate ${input.batchSize} UNIQUE questions.

${
  isMultiType
    ? `Use only these selected question types: ${selectedTypesText}.
Distribute generated questions across the selected types as evenly as possible.
You MUST set the 'type' field for each question.`
    : `ALL questions must be '${selectedType}' type.
You MUST set the 'type' field to '${selectedType}' for each question.`
}

Each question must have a genuine '${input.difficulty}' difficulty level:
- 'easy' questions should be straightforward recall from the text.
- 'medium' questions should require some interpretation or connection of ideas.
- 'hard' questions should require deep conceptual understanding or synthesis.

${isStrict ? `Questions and answers must be taken *strictly* and *literally* from the text. The wording should be as close as possible to the source document.` : `Questions should be *formed from* the document's content, allowing for rephrasing, synthesis, and conceptual understanding. You can create scenarios or examples that test the application of concepts.`}

If the document appears to be a past-question or question-only material where explicit answers are not provided, infer the best correct answers using reliable subject knowledge and context from each question.
For multiple-choice and true-or-false questions, always provide a best-answer decision.

CRITICAL: You MUST NOT generate questions that are already present in the "Existing Questions" list below. Generate NEW, UNIQUE questions only.
Be concise — keep question stems and answer choices short.

**GROUNDING RULES:**
- Only generate questions whose answers are present in or directly derivable from the Document Content below. Do NOT include questions that rely on outside knowledge or that the document cannot answer.
- Spread the questions across DIFFERENT topics and sections of the content rather than repeatedly targeting the same passage.
- If the document is a past-question or question-only sheet without explicit answers, base every question on the topics the document covers and ensure each answer can be reasoned from the document (or the question itself).`;

  if (input.priorityTopics && input.priorityTopics.length > 0) {
    prompt += `\n\nPRIORITY TOPICS — Bias approximately 60% of questions toward these topics:
${input.priorityTopics.map((t) => `- ${t}`).join('\n')}`;
  }

  if (input.seedQuestions && input.seedQuestions.length > 0) {
    prompt += `\n\nSEED QUESTIONS — Include some of these past questions verbatim or lightly reworded (they are valid for the document content):
${input.seedQuestions.map((q) => `- ${q}`).join('\n')}`;
  }

  prompt += `\n\nExisting Questions:
${existingQuestionsText}

**RESPONSE FORMAT RULES:**
- For **'multiple choice'**: Provide question text, an array of 4 choices, and the correct answer (string).
- For **'true or false'**: Provide question statement and boolean correct answer.
- For **'fill-in-the-blank'**: Provide question sentence with a blank "____". No correctAnswer needed.
- For **'theory'**: Provide open-ended question. No correctAnswer needed.

Document Content:
\`\`\`
${input.documentContent}
\`\`\`

Generate ${input.batchSize} unique, diverse questions now. Return them in a JSON object with a 'questions' array. Return ONLY valid JSON, no markdown formatting. Be concise.`;

  return prompt;
};

function validateQuestion(q: RawQuestion): boolean {
  if (!q || typeof q.question !== 'string' || !q.question.trim()) return false;
  if (q.type === 'multiple choice') {
    const choices = Array.isArray(q.choices) ? q.choices.filter((c) => typeof c === 'string' && c.trim()) : [];
    if (choices.length !== 4) return false;
    if (typeof q.correctAnswer !== 'string' || !q.correctAnswer.trim()) return false;
    if (!choices.includes(q.correctAnswer)) return false;
    return true;
  }
  if (q.type === 'true or false') {
    return typeof q.correctAnswer === 'boolean';
  }
  return q.type === 'fill-in-the-blank' || q.type === 'theory';
}

const normalizeBatch = (raw: { questions?: unknown }): GenerateBatchTestQuestionsOutput => {
  const list = Array.isArray(raw.questions) ? (raw.questions as RawQuestion[]) : [];
  const valid = list.filter(validateQuestion);
  return {
    questions: valid.map((q) =>
      shuffleMultipleChoiceChoices(q as z.infer<typeof SingleQuestionSchema>),
    ),
  };
};

export async function generateBatchTestQuestions(input: GenerateBatchTestQuestionsInput): Promise<GenerateBatchTestQuestionsOutput> {
  await enforceRateLimit(RateLimitPresets.testGeneration);
  // Streaming for faster first-byte — batch generation can be slow when waiting for full response
  const raw = await callJsonStream(SYSTEM, USER_PROMPT(input), {
    maxOutputTokens: input.batchSize * 1024,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse batch-question response: ${
        error instanceof Error ? error.message : 'unknown error'
      }. Response preview: ${raw.slice(0, 200)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray((parsed as { questions?: unknown }).questions)) {
    throw new Error(
      `Batch response missing "questions" array. Response preview: ${raw.slice(0, 200)}`,
    );
  }
  return normalizeBatch(parsed as { questions?: unknown });
}
