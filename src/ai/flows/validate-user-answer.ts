"use server";
/**
 * @fileOverview A flow to validate a user's answer to a question.
 */

import { ai, withDualGeminiFallback } from "@/ai/genkit";
import { z } from "genkit";

const ValidateUserAnswerInputSchema = z.object({
  documentContent: z
    .string()
    .describe("The text content of the study document."),
  question: z.string().describe("The question that was asked."),
  userAnswer: z.string().describe("The answer provided by the user."),
  correctAnswer: z.string().describe("The correct answer to the question."),
  questionSource: z
    .enum(["strict", "formed"])
    .describe("The marking mode used for grading tolerance."),
});
export type ValidateUserAnswerInput = z.infer<
  typeof ValidateUserAnswerInputSchema
>;

const ValidateUserAnswerOutputSchema = z.object({
  isCorrect: z.boolean().describe("Whether the user's answer is correct."),
  feedback: z.string().describe("Feedback on the user's answer."),
});
export type ValidateUserAnswerOutput = z.infer<
  typeof ValidateUserAnswerOutputSchema
>;

export async function validateUserAnswer(
  input: ValidateUserAnswerInput,
): Promise<ValidateUserAnswerOutput> {
  const systemInstruction =
    "You are a study assistant that validates user answers to questions.";

  const userPrompt = `Evaluate whether the user's answer is correct by comparing it to the correct answer and the document content.

If the provided correct answer is missing, empty, or unclear, first infer the best expected answer from the question.
When the document does not contain enough information, use reliable general subject knowledge to infer the expected answer.
Then grade the user's answer against that inferred expected answer.

Marking Mode: ${input.questionSource}
- If mode is "strict": require close factual alignment, key terminology, and high precision.
- If mode is "formed": allow semantically equivalent paraphrases and concept-level correctness even if wording differs.

Question: ${input.question}
User's Answer: ${input.userAnswer}
Correct Answer: ${input.correctAnswer}

Document Content:
\`\`\`
${input.documentContent}
\`\`\`

Determine if the user's answer is correct (it doesn't need to be word-for-word, but should convey the same meaning).
Provide helpful feedback.

Return ONLY valid JSON in this format:
{
  "isCorrect": true or false,
  "feedback": "your feedback here"
}`;

  return withDualGeminiFallback(
    async () => {
      return await validateUserAnswerFlow(input);
    },
    {
      systemInstruction,
      userPrompt,
      parseResponse: (rawResponse: string) => {
        const cleaned = rawResponse
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
        return JSON.parse(cleaned) as ValidateUserAnswerOutput;
      },
    },
  );
}

const prompt = ai.definePrompt({
  name: "validateUserAnswerPrompt",
  input: { schema: ValidateUserAnswerInputSchema },
  output: { schema: ValidateUserAnswerOutputSchema },
  prompt: `You are a study assistant that validates user answers to questions.

Evaluate whether the user's answer is correct by comparing it to the correct answer and the document content.

If the provided correct answer is missing, empty, or unclear, first infer the best expected answer from the question.
When the document does not contain enough information, use reliable general subject knowledge to infer the expected answer.
Then grade the user's answer against that inferred expected answer.

Marking Mode: {{questionSource}}
- If mode is "strict": require close factual alignment, key terminology, and high precision.
- If mode is "formed": allow semantically equivalent paraphrases and concept-level correctness even if wording differs.

Question: {{question}}
User's Answer: {{userAnswer}}
Correct Answer: {{correctAnswer}}

Document Content:
\`\`\`
{{{documentContent}}}
\`\`\`

Determine if the user's answer is correct (it doesn't need to be word-for-word, but should convey the same meaning).
Provide helpful feedback.
`,
});

const validateUserAnswerFlow = async (
  input: ValidateUserAnswerInput,
): Promise<ValidateUserAnswerOutput> => {
  const { output } = await prompt(input, {
    model: "googleai/gemini-2.5-flash",
  });
  return output!;
};
