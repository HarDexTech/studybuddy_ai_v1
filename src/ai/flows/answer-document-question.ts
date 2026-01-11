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
  return answerDocumentQuestionFlow(input);
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

const answerDocumentQuestionFlow = ai.defineFlow(
  {
    name: 'answerDocumentQuestionFlow',
    inputSchema: AnswerDocumentQuestionInputSchema,
    outputSchema: AnswerDocumentQuestionOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
