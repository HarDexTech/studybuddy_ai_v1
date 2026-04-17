'use server';
/**
 * @fileOverview Generate multiple test questions in a single API call.
 *
 * - generateBatchTestQuestions - Generates 5 questions at once (much more efficient)
 */

import { ai, withDualGeminiFallback } from '@/ai/genkit';
import { shuffleMultipleChoiceChoices } from '@/lib/utils';
import { z } from 'genkit';

const GenerateBatchTestQuestionsInputSchema = z.object({
  documentContent: z.string().describe('The text content of the study document.'),
  questionTypes: z
    .array(z.enum(['multiple choice', 'fill-in-the-blank', 'theory', 'true or false']))
    .min(1)
    .describe('The selected question types to generate.'),
  difficulty: z.enum(['easy', 'medium', 'hard']).describe('The difficulty level.'),
  questionSource: z.enum(['strict', 'formed']).describe('The source of the questions.'),
  existingQuestions: z.array(z.string()).describe('Already generated questions to avoid duplicates.'),
  batchSize: z.number().default(5).describe('Number of questions to generate (default 5)'),
});
export type GenerateBatchTestQuestionsInput = z.infer<typeof GenerateBatchTestQuestionsInputSchema>;

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

const prompt = ai.definePrompt({
  name: 'generateBatchTestQuestionsPrompt',
  input: {
    schema: GenerateBatchTestQuestionsInputSchema.extend({
      isStrict: z.boolean(),
      isMultiType: z.boolean(),
      selectedType: z.string(),
    }),
  },
  output: { schema: GenerateBatchTestQuestionsOutputSchema },
  prompt: `You are an expert test generator that creates high-quality test questions from uploaded documents.

Your main instruction is to generate {{batchSize}} UNIQUE questions.

{{#if isMultiType}}
Use only these selected question types:
{{#each questionTypes}}
- {{{this}}}
{{/each}}
Distribute generated questions across the selected types as evenly as possible.
You MUST set the 'type' field for each question.
{{else}}
ALL questions must be '{{selectedType}}' type.
You MUST set the 'type' field to '{{selectedType}}' for each question.
{{/if}}

Each question must have a genuine '{{difficulty}}' difficulty level:
- 'easy' questions should be straightforward recall from the text.
- 'medium' questions should require some interpretation or connection of ideas.
- 'hard' questions should require deep conceptual understanding or synthesis.

{{#if isStrict}}
Questions and answers must be taken *strictly* and *literally* from the text. The wording should be as close as possible to the source document.
{{else}}
Questions should be *formed from* the document's content, allowing for rephrasing, synthesis, and conceptual understanding. You can create scenarios or examples that test the application of concepts.
{{/if}}

If the document appears to be a past-question or question-only material where explicit answers are not provided, infer the best correct answers using reliable subject knowledge and context from each question.
For multiple-choice and true-or-false questions, always provide a best-answer decision.

CRITICAL: You MUST NOT generate questions that are already present in the "Existing Questions" list below. Generate NEW, UNIQUE questions only.

Existing Questions:
{{#each existingQuestions}}
- {{{this}}}
{{/each}}

**RESPONSE FORMAT RULES:**
- For **'multiple choice'**: Provide question text, an array of 4 choices, and the correct answer (string).
- For **'true or false'**: Provide question statement and boolean correct answer.
- For **'fill-in-the-blank'**: Provide question sentence with a blank "____". No correctAnswer needed.
- For **'theory'**: Provide open-ended question. No correctAnswer needed.

Document Content:
\`\`\`
{{{documentContent}}}
\`\`\`

Generate {{batchSize}} unique, diverse questions now. Return them in a JSON object with a 'questions' array.
`,
});

export async function generateBatchTestQuestions(input: GenerateBatchTestQuestionsInput): Promise<GenerateBatchTestQuestionsOutput> {
  const isStrict = input.questionSource === 'strict';
  const isMultiType = input.questionTypes.length > 1;
  const selectedType = input.questionTypes[0];
  const selectedTypesText = input.questionTypes.map((type) => `"${type}"`).join(', ');

  const existingQuestionsText = input.existingQuestions.length > 0 ? input.existingQuestions.map((q) => `- ${q}`).join('\n') : '- (none yet)';

  const systemInstruction = 'You are an expert test generator that creates high-quality test questions from uploaded documents.';

  const userPrompt = `Your main instruction is to generate ${input.batchSize} UNIQUE questions.

${
  isMultiType
    ? `Use only these selected question types: ${selectedTypesText}.
Distribute generated questions across the selected types as evenly as possible.
You MUST set the 'type' field for each question.
`
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

Existing Questions:
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

Generate ${input.batchSize} unique, diverse questions now. Return them in a JSON object with a 'questions' array. Return ONLY valid JSON, no markdown formatting.`;

  return withDualGeminiFallback(
    async () => {
      const { output } = await prompt({ ...input, isStrict, isMultiType, selectedType }, { model: 'googleai/gemini-2.5-flash' });

      const normalizedQuestions = (output?.questions || []).map((question) => shuffleMultipleChoiceChoices(question));

      return {
        questions: normalizedQuestions,
      };
    },
    {
      systemInstruction,
      userPrompt,
      parseResponse: (rawResponse: string) => {
        const cleaned = rawResponse
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        const parsed = JSON.parse(cleaned) as GenerateBatchTestQuestionsOutput;
        return {
          questions: (parsed.questions || []).map((question) => shuffleMultipleChoiceChoices(question)),
        };
      },
    },
  );
}
