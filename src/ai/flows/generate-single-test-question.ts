'use server';
/**
 * @fileOverview A flow to generate a single test question with automatic fallback.
 *
 * - generateSingleTestQuestion - Generates one test question based on document content and settings.
 * - GenerateSingleTestQuestionInput - The input type for the function.
 * - GenerateSingleTestQuestionOutput - The return type for the function.
 */

import { ai, withDualGeminiFallback } from '@/ai/genkit';
import { z } from 'genkit';

const GenerateSingleTestQuestionInputSchema = z.object({
  documentContent: z
    .string()
    .describe('The text content of the study document.'),
  questionType: z
    .enum([
      'multiple choice',
      'fill-in-the-blank',
      'theory',
      'true or false',
      'all',
    ])
    .describe('The type of question for the generated test.'),
  difficulty: z
    .enum(['easy', 'medium', 'hard'])
    .describe('The difficulty level of the question.'),
  questionSource: z
    .enum(['strict', 'formed'])
    .describe('The source of the question.'),
  existingQuestions: z
    .array(z.string())
    .describe(
      'An array of question texts that have already been generated in this test session to avoid duplicates.',
    ),
});
export type GenerateSingleTestQuestionInput = z.infer<
  typeof GenerateSingleTestQuestionInputSchema
>;

const MultipleChoiceSchema = z.object({
  question: z.string().describe('The multiple choice question text.'),
  choices: z
    .array(z.string())
    .min(4)
    .max(4)
    .describe('An array of exactly 4 possible answers.'),
  correctAnswer: z.string().describe('The correct answer from the choices.'),
});

const TrueFalseSchema = z.object({
  question: z.string().describe('The true or false statement.'),
  correctAnswer: z
    .boolean()
    .describe('Whether the statement is true or false.'),
});

const FillInTheBlankSchema = z.object({
  question: z
    .string()
    .describe('The sentence with a blank, represented as "____".'),
});

const TheorySchema = z.object({
  question: z.string().describe('The open-ended theory question.'),
});

const AllTypesSchema = z.object({
  type: z
    .enum(['multiple choice', 'fill-in-the-blank', 'theory', 'true or false'])
    .describe('The type of question.'),
  question: z.string().describe('The question text.'),
  choices: z
    .array(z.string())
    .optional()
    .describe('The possible answers for multiple choice.'),
  correctAnswer: z
    .union([z.string(), z.boolean()])
    .optional()
    .describe('The correct answer.'),
});

const GenerateSingleTestQuestionOutputSchema = z.union([
  MultipleChoiceSchema,
  TrueFalseSchema,
  FillInTheBlankSchema,
  TheorySchema,
  AllTypesSchema,
]);
export type GenerateSingleTestQuestionOutput = z.infer<
  typeof GenerateSingleTestQuestionOutputSchema
>;

// Build prompt text for fallback
function buildFallbackPrompt(input: GenerateSingleTestQuestionInput): {
  systemInstruction: string;
  userPrompt: string;
} {
  const isStrict = input.questionSource === 'strict';
  const isAllTypes = input.questionType === 'all';

  const existingQuestionsText =
    input.existingQuestions.length > 0
      ? input.existingQuestions.map((q) => `- ${q}`).join('\n')
      : '- (none yet)';

  const systemInstruction =
    'You are an expert test generator that creates one high-quality test question from an uploaded document.';

  const userPrompt = `Your main instruction is to generate a single question of the type specified in 'questionType'.

${
  isAllTypes
    ? `The 'questionType' is 'all', so you must randomly choose one type from the following list for the question you will generate: "multiple choice", "fill-in-the-blank", "theory", or "true or false".
You MUST set the 'type' field in your response to the chosen question type.`
    : `You MUST generate a '${input.questionType}' question. You should NOT include a 'type' field in your response.`
}

The question must have a genuine '${input.difficulty}' difficulty level.
- 'easy' questions should be straightforward recall from the text.
- 'medium' questions should require some interpretation or connection of ideas from different parts of the document.
- 'hard' questions should require deep conceptual understanding, synthesis of multiple complex points, or application of knowledge in a new context.

Your instructions for question generation source are as follows:
${isStrict ? `The question and its answer must be taken *strictly* and *literally* from the text. The wording should be as close as possible to the source document.` : `The question should be *formed from* the document's content, allowing for rephrasing, synthesis, and conceptual understanding questions related to the topics. You can create scenarios or examples that test the application of the document's concepts.`}

If the document appears to be a past-question or question-only material where explicit answers are not provided, you should infer the best correct answer using reliable subject knowledge and context from the question itself.
Do not leave a multiple-choice or true-or-false item without a best-answer decision.

You MUST NOT generate a question that is already present in the "Existing Questions" list. Generate a new, unique question.

Existing Questions:
${existingQuestionsText}

**CRITICAL INSTRUCTIONS FOR RESPONSE FORMAT:**
- For **'multiple choice'**: You must provide the question text, an array of 4 choices, and the correct answer.
- For **'true or false'**: You must provide the question statement and the boolean correct answer.
- For **'fill-in-the-blank'**: You must provide the question sentence containing a blank, like "____".
- For **'theory'**: You must provide an open-ended question.

Document Content:
\`\`\`
${input.documentContent}
\`\`\`

Generate one unique question now. Return ONLY valid JSON, no markdown formatting.`;

  return { systemInstruction, userPrompt };
}

// Parse response from secondary API
function parseSecondaryResponse(
  rawResponse: string,
): GenerateSingleTestQuestionOutput {
  try {
    const cleaned = rawResponse
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    if (!parsed.question) {
      throw new Error('Missing required "question" field');
    }

    return parsed as GenerateSingleTestQuestionOutput;
  } catch (error) {
    console.error('Failed to parse secondary API response:', error);
    throw new Error('Failed to parse AI response into test question format');
  }
}

export async function generateSingleTestQuestion(
  input: GenerateSingleTestQuestionInput,
): Promise<GenerateSingleTestQuestionOutput> {
  // Build fallback params
  const fallbackParams = buildFallbackPrompt(input);

  // Use dual Gemini fallback wrapper with fallback params
  const result = await withDualGeminiFallback(
    async () => {
      return await generateSingleTestQuestionFlow(input);
    },
    {
      systemInstruction: fallbackParams.systemInstruction,
      userPrompt: fallbackParams.userPrompt,
      parseResponse: parseSecondaryResponse,
    },
  );

  // Manually add the type back in for the non-"all" cases.
  if (input.questionType !== 'all') {
    return {
      type: input.questionType,
      ...result,
    };
  }
  return result;
}

const prompt = ai.definePrompt({
  name: 'generateSingleTestQuestionPrompt',
  input: {
    schema: GenerateSingleTestQuestionInputSchema.extend({
      isStrict: z.boolean(),
      isAllTypes: z.boolean(),
    }),
  },
  output: { schema: GenerateSingleTestQuestionOutputSchema },
  prompt: `You are an expert test generator that creates one high-quality test question from an uploaded document.

Your main instruction is to generate a single question of the type specified in 'questionType'.
{{#if isAllTypes}}
The 'questionType' is 'all', so you must randomly choose one type from the following list for the question you will generate: "multiple choice", "fill-in-the-blank", "theory", or "true or false".
You MUST set the 'type' field in your response to the chosen question type.
{{else}}
You MUST generate a '{{questionType}}' question. You should NOT include a 'type' field in your response.
{{/if}}

The question must have a genuine '{{difficulty}}' difficulty level.
- 'easy' questions should be straightforward recall from the text.
- 'medium' questions should require some interpretation or connection of ideas from different parts of the document.
- 'hard' questions should require deep conceptual understanding, synthesis of multiple complex points, or application of knowledge in a new context.

Your instructions for question generation source are as follows:
{{#if isStrict}}
The question and its answer must be taken *strictly* and *literally* from the text. The wording should be as close as possible to the source document.
{{else}}
The question should be *formed from* the document's content, allowing for rephrasing, synthesis, and conceptual understanding questions related to the topics. You can create scenarios or examples that test the application of the document's concepts.
{{/if}}

If the document appears to be a past-question or question-only material where explicit answers are not provided, infer the best correct answer using reliable subject knowledge and context from the question itself.
For multiple-choice and true-or-false questions, always provide a best-answer decision.

You MUST NOT generate a question that is already present in the "Existing Questions" list. Generate a new, unique question.

Existing Questions:
{{#each existingQuestions}}
- {{{this}}}
{{/each}}

**CRITICAL INSTRUCTIONS FOR RESPONSE FORMAT:**
- For **'multiple choice'**: You must provide the question text, an array of 4 choices, and the correct answer, ensure the correct answer is randomly placed among options A, B, C, or D. Do NOT favor any particular position (B or C). Vary the correct answer position across questions to create balanced, natural-looking question sets. Each position (A, B, C, D) should have roughly equal probability of being correct across the generated questions.
- For **'true or false'**: You must provide the question statement and the boolean correct answer.
- For **'fill-in-the-blank'**: You must provide the question sentence containing a blank, like "____".
- For **'theory'**: You must provide an open-ended question.

Document Content:
\`\`\`
{{{documentContent}}}
\`\`\`

Generate one unique question now.
`,
});

const generateSingleTestQuestionFlow = async (
  input: GenerateSingleTestQuestionInput,
): Promise<GenerateSingleTestQuestionOutput> => {
  const isStrict = input.questionSource === 'strict';
  const isAllTypes = input.questionType === 'all';

  const { output } = await prompt(
    { ...input, isStrict, isAllTypes },
    { model: 'googleai/gemini-2.5-flash' },
  );

  return output!;
};
