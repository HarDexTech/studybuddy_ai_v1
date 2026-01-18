'use server';

/**
 * @fileOverview A flow to validate user answers against the content of a study document.
 *
 * - validateUserAnswer - A function that handles the validation process.
 * - ValidateUserAnswerInput - The input type for the validateUserAnswer function.
 * - ValidateUserAnswerOutput - The return type for the validateUserAnswer function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { withFallback } from '@/ai/fallback-helper';

const ValidateUserAnswerInputSchema = z.object({
  documentContent: z
    .string()
    .describe('The complete text content of the study document.'),
  question: z.string().describe('The question asked in the test.'),
  questionType: z.string().describe('The type of question asked.'),
  userAnswer: z.string().describe('The answer provided by the user.'),
  questionSource: z.enum(['strict', 'formed']).describe('The source of the questions.'),
});
export type ValidateUserAnswerInput = z.infer<typeof ValidateUserAnswerInputSchema>;

const ValidateUserAnswerOutputSchema = z.object({
  isCorrect: z.boolean().describe('Whether the user answer is correct or not.'),
  feedback: z.string().describe('Feedback on the user answer.'),
});
export type ValidateUserAnswerOutput = z.infer<typeof ValidateUserAnswerOutputSchema>;

export async function validateUserAnswer(input: ValidateUserAnswerInput): Promise<ValidateUserAnswerOutput> {
  return withFallback(async (modelName) => {
    return await validateUserAnswerFlow(input, modelName);
  });
}

const prompt = ai.definePrompt({
  name: 'validateUserAnswerPrompt',
  input: {schema: ValidateUserAnswerInputSchema.extend({ isStrict: z.boolean() })},
  output: {schema: ValidateUserAnswerOutputSchema},
  prompt: `You are an expert educator and evaluator. Your task is to validate a student's answer to a question based on the provided Study Document Content.

This validation is ONLY for 'fill-in-the-blank' or 'theory' (open-ended) questions. 'Multiple choice' and 'true/false' are handled elsewhere.

Study Document Content:
\`\`\`
{{{documentContent}}}
\`\`\`

Question Type: {{{questionType}}}
Question:
"{{{question}}}"

User's Answer:
"{{{userAnswer}}}"

{{#if isStrict}}
Instructions for Evaluation (Strict Mode):
1.  **Role**: You are an extremely strict evaluator. You must not use any external knowledge whatsoever.
2.  **Analyze the Document**: Carefully read the "Study Document Content". This is the only source of truth.
3.  **Evaluate the Answer**: Compare the "User's Answer" to the information in the document.
    - For 'fill-in-the-blank', the user's answer must match or be a very close synonym to the missing word(s) from the document.
    - For 'theory' questions, the user's answer must be directly and explicitly supported by the content in the document.
4.  **Strictness is Key**: Do not infer meaning. If the user's answer includes information not present in the document, it is incorrect.
5.  **Set 'isCorrect'**:
    *   Set to \`true\` if, and only if, the answer is unequivocally and literally correct according to the document.
    *   Set to \`false\` if the answer is incorrect, partially correct, or not found in the document.
{{else}}
Instructions for Evaluation (Formed Mode):
1.  **Role**: You are an expert educator. Your goal is to assess conceptual understanding.
2.  **Analyze the Document**: Use the "Study Document Content" as the primary source of truth for the core concepts.
3.  **Evaluate the Answer**: Assess if the "User's Answer" is conceptually and factually correct based on the topics presented in the document.
    - For 'fill-in-the-blank', the answer should be contextually correct.
    - For 'theory' questions, the answer should demonstrate a correct understanding of the concept as it relates to the document's content.
    The answer does not need to be a literal quote from the text, but it must be consistent with the information and principles within it.
4.  **Set 'isCorrect'**:
    *   Set to \`true\` if the answer demonstrates a correct understanding of the concept.
    *   Set to \`false\` if the answer is factually incorrect, misunderstands the concept, or contradicts the document.
{{/if}}

Common Instructions:
1.  **Provide Feedback**:
    *   If correct, briefly confirm it. Example: "Correct. Your answer is accurate." or "Correct. That's the right idea."
    *   If incorrect, explain clearly and concisely why it is wrong, citing the correct information from the document. For example: "Incorrect. The document states that..." or "Incorrect. The concept is actually..."
    *   Keep feedback brief and to the point.
2.  **Final Check**: Your evaluation must be consistent with the selected mode (Strict or Formed). If the user provided no answer (an empty string), they are incorrect.
`,
});

const validateUserAnswerFlow = async (
  input: ValidateUserAnswerInput,
  modelName: string
): Promise<ValidateUserAnswerOutput> => {
  const isStrict = input.questionSource === 'strict';
  const {output} = await prompt({...input, isStrict}, { model: modelName });
  return output!;
};
