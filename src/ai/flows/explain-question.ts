"use server";
/**
 * @fileOverview Explain why an answer to a question is correct.
 */

import { callNimJson } from "@/ai/api";
import { RateLimitPresets, enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const ExplainQuestionInputSchema = z.object({
  documentContent: z
    .string()
    .describe("The text content of the study document."),
  question: z.string().describe("The question that was asked."),
  correctAnswer: z
    .string()
    .describe("The correct answer to the question."),
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

const SYSTEM =
  "You are a study assistant that helps students understand why answers to questions are correct.";

const USER_PROMPT = (input: ExplainQuestionInput) =>
  `Given the document content, the question, and the correct answer, provide a detailed explanation of:
1. What the question is asking
2. Why the provided answer is correct
3. Supporting information from the document

Question: ${input.question}
Correct Answer: ${input.correctAnswer}

Document Content:
\`\`\`
${input.documentContent}
\`\`\`

Provide a clear, educational explanation. Return ONLY valid JSON in this exact format with no markdown:
{
  "explanation": "your detailed explanation here"
}`;

export async function explainQuestion(
  input: ExplainQuestionInput,
): Promise<ExplainQuestionOutput> {
  await enforceRateLimit(RateLimitPresets.explain);
  return callNimJson(SYSTEM, USER_PROMPT(input), (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Failed to parse explanation response: ${
          error instanceof Error ? error.message : "unknown error"
        }. Response preview: ${raw.slice(0, 200)}`,
      );
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      typeof (parsed as { explanation?: unknown }).explanation !== "string"
    ) {
      throw new Error(
        `Missing or invalid "explanation" field. Response preview: ${raw.slice(0, 200)}`,
      );
    }
    return parsed as ExplainQuestionOutput;
  });
}
