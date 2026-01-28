"use server";
/**
 * @fileOverview A flow to explain why an answer to a question is correct.
 */

import { ai, withDualGeminiFallback } from "@/ai/genkit";
import { z } from "genkit";

const ExplainQuestionInputSchema = z.object({
  documentContent: z
    .string()
    .describe("The text content of the study document."),
  question: z.string().describe("The question that was asked."),
  correctAnswer: z.string().describe("The correct answer to the question."),
});
export type ExplainQuestionInput = z.infer<typeof ExplainQuestionInputSchema>;

const ExplainQuestionOutputSchema = z.object({
  explanation: z
    .string()
    .describe(
      "A detailed explanation of the question and why the provided answer is correct, based on the document content.",
    ),
});
export type ExplainQuestionOutput = z.infer<typeof ExplainQuestionOutputSchema>;

export async function explainQuestion(
  input: ExplainQuestionInput,
): Promise<ExplainQuestionOutput> {
  const systemInstruction =
    "You are a study assistant that helps students understand why answers to questions are correct.";

  const userPrompt = `Given the document content, the question, and the correct answer, provide a detailed explanation of:
1. What the question is asking
2. Why the provided answer is correct
3. Supporting information from the document

Question: ${input.question}
Correct Answer: ${input.correctAnswer}

Document Content:
\`\`\`
${input.documentContent}
\`\`\`

Provide a clear, educational explanation. Return ONLY valid JSON in this format:
{
  "explanation": "your detailed explanation here"
}`;

  return withDualGeminiFallback(
    async () => {
      return await explainQuestionFlow(input);
    },
    {
      systemInstruction,
      userPrompt,
      parseResponse: (rawResponse: string) => {
        const cleaned = rawResponse
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
        return JSON.parse(cleaned) as ExplainQuestionOutput;
      },
    },
  );
}

const prompt = ai.definePrompt({
  name: "explainQuestionPrompt",
  input: { schema: ExplainQuestionInputSchema },
  output: { schema: ExplainQuestionOutputSchema },
  prompt: `You are a study assistant that helps students understand why answers to questions are correct.

Given the document content, the question, and the correct answer, provide a detailed explanation of:
1. What the question is asking
2. Why the provided answer is correct
3. Supporting information from the document

Question: {{question}}
Correct Answer: {{correctAnswer}}

Document Content:
\`\`\`
{{{documentContent}}}
\`\`\`

Provide a clear, educational explanation.
`,
});

const explainQuestionFlow = async (
  input: ExplainQuestionInput,
): Promise<ExplainQuestionOutput> => {
  const { output } = await prompt(input, {
    model: "googleai/gemini-2.5-flash",
  });
  return output!;
};
