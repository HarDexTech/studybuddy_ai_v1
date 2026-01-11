'use server';
/**
 * @fileOverview A flow to provide a detailed explanation for a test question.
 *
 * - explainQuestion - Generates an explanation for a question and its correct answer.
 * - ExplainQuestionInput - The input type for the function.
 * - ExplainQuestionOutput - The return type for the function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ExplainQuestionInputSchema = z.object({
  documentContent: z
    .string()
    .describe('The text content of the study document.'),
  question: z.string().describe('The question that was asked.'),
  correctAnswer: z.string().describe('The correct answer to the question.'),
});
export type ExplainQuestionInput = z.infer<typeof ExplainQuestionInputSchema>;

const ExplainQuestionOutputSchema = z.object({
    explanation: z.string().describe("A detailed explanation of the question and why the provided answer is correct, based on the document content."),
});
export type ExplainQuestionOutput = z.infer<typeof ExplainQuestionOutputSchema>;

export async function explainQuestion(input: ExplainQuestionInput): Promise<ExplainQuestionOutput> {
  return explainQuestionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'explainQuestionPrompt',
  input: {schema: ExplainQuestionInputSchema},
  output: {schema: ExplainQuestionOutputSchema},
  prompt: `You are a helpful study assistant. Your task is to provide a clear and detailed explanation for a test question, based *only* on the provided "Document Content".

Your explanation should break down the question, explain the underlying concept, and show where in the document the correct answer can be found.

Document Content:
\`\`\`
{{{documentContent}}}
\`\`\`

Question:
"{{{question}}}"

Correct Answer:
"{{{correctAnswer}}}"

Provide a detailed explanation now.
`,
});

const explainQuestionFlow = ai.defineFlow(
  {
    name: 'explainQuestionFlow',
    inputSchema: ExplainQuestionInputSchema,
    outputSchema: ExplainQuestionOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
