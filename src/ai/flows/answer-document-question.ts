'use server';
/**
 * @fileOverview A flow to answer a question about the document content.
 */

import {ai, withDualGeminiFallback} from '@/ai/genkit';
import {z} from 'genkit';

const AnswerDocumentQuestionInputSchema = z.object({
  documentContent: z
    .string()
    .describe('The text content of the study document.'),
  question: z.string().describe('The question to answer about the document.'),
});
export type AnswerDocumentQuestionInput = z.infer<typeof AnswerDocumentQuestionInputSchema>;

const AnswerDocumentQuestionOutputSchema = z.object({
  answer: z.string().describe('The answer to the question based on the document content.'),
});
export type AnswerDocumentQuestionOutput = z.infer<typeof AnswerDocumentQuestionOutputSchema>;

export async function answerDocumentQuestion(input: AnswerDocumentQuestionInput): Promise<AnswerDocumentQuestionOutput> {
  return withDualGeminiFallback(async () => {
    return await answerDocumentQuestionFlow(input);
  });
}

const prompt = ai.definePrompt({
  name: 'answerDocumentQuestionPrompt',
  input: {schema: AnswerDocumentQuestionInputSchema},
  output: {schema: AnswerDocumentQuestionOutputSchema},
  prompt: `You are a study assistant that answers questions about document content.

Based on the document content provided below, answer the following question accurately and concisely.

Question: {{question}}

Document Content:
\`\`\`
{{{documentContent}}}
\`\`\`

Provide a clear, accurate answer based on the document.
`,
});

const answerDocumentQuestionFlow = async (
  input: AnswerDocumentQuestionInput
): Promise<AnswerDocumentQuestionOutput> => {
  const {output} = await prompt(input, { model: 'googleai/gemini-2.0-flash-exp' });
  return output!;
};