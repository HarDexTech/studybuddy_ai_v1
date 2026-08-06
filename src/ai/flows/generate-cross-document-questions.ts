'use server';
/**
 * @fileOverview Generate test questions that span multiple uploaded documents.
 */

import { callNimJson } from '@/ai/api';
import { RateLimitPresets, enforceRateLimit } from '@/lib/rate-limit';
import { shuffleMultipleChoiceChoices } from '@/lib/utils';
import { z } from 'zod';

const DocumentSchema = z.object({
  name: z.string().describe('The file name of the document.'),
  content: z.string().describe('The full text content of the document.'),
});

const GenerateCrossDocumentQuestionsInputSchema = z.object({
  documents: z
    .array(DocumentSchema)
    .min(2)
    .describe('The documents to generate cross-document questions from.'),
  questionTypes: z
    .array(z.enum(['multiple choice', 'fill-in-the-blank', 'theory', 'true or false']))
    .min(1)
    .describe('The selected question types to generate.'),
  difficulty: z.enum(['easy', 'medium', 'hard']).describe('The difficulty level.'),
  questionSource: z.enum(['strict', 'formed']).describe('The source of the questions.'),
  numberOfQuestions: z.number().min(1).max(10).default(5).describe('Number of questions to generate.'),
  existingQuestions: z.array(z.string()).describe('Already generated questions to avoid duplicates.'),
  priorityTopics: z.array(z.string()).optional().describe('Topics to prioritize / bias questions toward.'),
  seedQuestions: z.array(z.string()).optional().describe('Past questions to reuse verbatim or lightly reworded.'),
});
export type GenerateCrossDocumentQuestionsInput = z.infer<typeof GenerateCrossDocumentQuestionsInputSchema>;

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
  sourceDoc: z.string().optional().describe('The document(s) this question is based on.'),
});

const GenerateCrossDocumentQuestionsOutputSchema = z.object({
  questions: z.array(SingleQuestionSchema).describe('Array of generated cross-document questions'),
});
export type GenerateCrossDocumentQuestionsOutput = z.infer<typeof GenerateCrossDocumentQuestionsOutputSchema>;

const SYSTEM = 'You are an expert test generator that creates questions from multiple uploaded documents, with each question based on a single source document.';

const USER_PROMPT = (input: GenerateCrossDocumentQuestionsInput) => {
  const isStrict = input.questionSource === 'strict';
  const isMultiType = input.questionTypes.length > 1;
  const selectedType = input.questionTypes[0];
  const selectedTypesText = input.questionTypes.join(', ');
  const documentsText = input.documents
    .map((d, i) => `DOCUMENT ${i + 1}: "${d.name}"\n\`\`\`\n${d.content}\n\`\`\``)
    .join('\n\n');

  let prompt = `Create ${input.numberOfQuestions} test questions from the documents below. Mix TWO kinds of questions:
- SINGLE-DOCUMENT questions — about 2/3 of the total. Each one is answerable from ONE document alone, spread evenly across the documents so every document contributes roughly the same number. Do NOT combine knowledge from another document in these.
- COMBINED questions — about 1/3 of the total. These may synthesize or compare knowledge from MULTIPLE documents in a single question.

Documents:
${documentsText}

GROUNDING RULES:
- A single-document question's answer must be present in or directly derivable from its source document.
- A combined question's answer must be answerable using only the provided documents — never outside knowledge.
- Spread questions across DIFFERENT topics and sections of the relevant documents.
- Never mention "DOCUMENT 1", "DOCUMENT 2", the file name, or any document label inside the question text. Present only the subject content so each question reads naturally on its own.

${isMultiType ? `Question types: ${selectedTypesText}` : `All questions must be '${selectedType}' type.`}
Difficulty: ${input.difficulty}
${isStrict ? 'Questions must be strictly from the texts.' : 'Questions can be formed from the content.'}

For each question, set 'sourceDoc' to the name(s) of the document(s) the question is based on.`;

  if (input.priorityTopics && input.priorityTopics.length > 0) {
    prompt += `\n\nPRIORITY TOPICS — Bias approximately 60% of questions toward these topics:
${input.priorityTopics.map((t) => `- ${t}`).join('\n')}`;
  }

  if (input.seedQuestions && input.seedQuestions.length > 0) {
    prompt += `\n\nSEED QUESTIONS — Include some of these past questions verbatim or lightly reworded (they are valid for the document content):
${input.seedQuestions.map((q) => `- ${q}`).join('\n')}`;
  }

  prompt += `\n\nExisting questions to avoid: ${input.existingQuestions.length > 0 ? input.existingQuestions.map((q) => `"${q}"`).join(', ') : '(none)'}

Return ONLY valid JSON with a 'questions' array. Each question must have 'type', 'question', and for multiple choice also 'choices' (4 items) and 'correctAnswer'. For true/false set correctAnswer as boolean. No markdown.`;

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

const normalizeBatch = (raw: { questions?: unknown }): GenerateCrossDocumentQuestionsOutput => {
  const list = Array.isArray(raw.questions) ? (raw.questions as RawQuestion[]) : [];
  const valid = list.filter(validateQuestion);
  return {
    questions: valid.map((q) =>
      shuffleMultipleChoiceChoices(q as z.infer<typeof SingleQuestionSchema>),
    ),
  };
};

export async function generateCrossDocumentQuestions(
  input: GenerateCrossDocumentQuestionsInput,
): Promise<GenerateCrossDocumentQuestionsOutput> {
  await enforceRateLimit(RateLimitPresets.crossDoc);
  return callNimJson(SYSTEM, USER_PROMPT(input), (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Failed to parse cross-document response: ${
          error instanceof Error ? error.message : 'unknown error'
        }. Response preview: ${raw.slice(0, 200)}`,
      );
    }
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray((parsed as { questions?: unknown }).questions)) {
      throw new Error(
        `Cross-document response missing "questions" array. Response preview: ${raw.slice(0, 200)}`,
      );
    }
    return normalizeBatch(parsed as { questions?: unknown });
  });
}
