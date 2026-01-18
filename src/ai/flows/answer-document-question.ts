'use server';
/**
 * @fileOverview A flow to answer a user's question based on document content.
 *
 * - answerDocumentQuestion - Answers a question using the provided document.
 * - AnswerDocumentQuestionInput - The input type for the function.
 * - AnswerDocumentQuestionOutput - The return type for the function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { withFallback } from '@/ai/fallback-helper';

const AnswerDocumentQuestionInputSchema = z.object({
  documentContent: z
    .string()
    .describe('The text content of the study document.'),
  question: z.string().describe("The user's question about the document."),
});
export type AnswerDocumentQuestionInput = z.infer<typeof AnswerDocumentQuestionInputSchema>;

const AnswerDocumentQuestionOutputSchema = z.object({
    answer: z.string().describe("The AI's answer to the user's question."),
});
export type AnswerDocumentQuestionOutput = z.infer<typeof AnswerDocumentQuestionOutputSchema>;

export async function answerDocumentQuestion(input: AnswerDocumentQuestionInput): Promise<AnswerDocumentQuestionOutput> {
  return withFallback(async (modelName) => {
    return await answerDocumentQuestionFlow(input, modelName);
  });
}

const prompt = ai.definePrompt({
  name: 'answerDocumentQuestionPrompt',
  input: {schema: AnswerDocumentQuestionInputSchema},
  output: {schema: AnswerDocumentQuestionOutputSchema},
  prompt: `You are a helpful study assistant. Your task is to answer the user's question based *only* on the provided "Document Content". Do not use any external knowledge.

If the answer is not found in the document, you MUST state that clearly.

Document Content:
\`\`\`
{{{documentContent}}}
\`\`\`

User's Question:
"{{{question}}}"

Provide your answer now.
`,
});

const answerDocumentQuestionFlow = async (
  input: AnswerDocumentQuestionInput,
  modelName: string
): Promise<AnswerDocumentQuestionOutput> => {
  const {output} = await prompt(input, { model: modelName });
  return output!;
};
