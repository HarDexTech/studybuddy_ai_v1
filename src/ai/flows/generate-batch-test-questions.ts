'use server';
/**
 * @fileOverview Generate multiple test questions in a single API call.
 *
 * - generateBatchTestQuestions - Generates 5 questions at once (much more efficient)
 */

import {ai, withDualGeminiFallback} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateBatchTestQuestionsInputSchema = z.object({
  documentContent: z.string().describe('The text content of the study document.'),
  questionType: z.enum(['multiple choice', 'fill-in-the-blank', 'theory', 'true or false', 'all']).describe('The type of questions to generate.'),
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
      isAllTypes: z.boolean() 
    })
  },
  output: {schema: GenerateBatchTestQuestionsOutputSchema},
  prompt: `You are an expert test generator that creates high-quality test questions from uploaded documents.

Your main instruction is to generate {{batchSize}} UNIQUE questions.

{{#if isAllTypes}}
For each question, randomly choose a type from: "multiple choice", "fill-in-the-blank", "theory", or "true or false".
You MUST set the 'type' field for each question.
Vary the question types across the batch.
{{else}}
ALL questions must be '{{questionType}}' type.
You MUST set the 'type' field to '{{questionType}}' for each question.
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

export async function generateBatchTestQuestions(
  input: GenerateBatchTestQuestionsInput
): Promise<GenerateBatchTestQuestionsOutput> {
  const isStrict = input.questionSource === 'strict';
  const isAllTypes = input.questionType === 'all';

  return withDualGeminiFallback(async () => {
    const {output} = await prompt(
      {...input, isStrict, isAllTypes},
      { model: 'googleai/gemini-2.0-flash-exp' }
    );
    
    return output!;
  });
}