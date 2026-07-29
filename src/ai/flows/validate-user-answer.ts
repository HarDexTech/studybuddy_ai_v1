"use server";
/**
 * @fileOverview Validate a user's answer to a question — streaming for low latency.
 */

import { callNimJsonStream } from "@/ai/api";
import { RateLimitPresets, enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

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
export type ValidateUserAnswerInput = z.infer<typeof ValidateUserAnswerInputSchema>;

const ValidateUserAnswerOutputSchema = z.object({
  isCorrect: z.boolean().describe("Whether the user's answer is correct."),
  feedback: z.string().describe("Feedback on the user's answer."),
});
export type ValidateUserAnswerOutput = z.infer<typeof ValidateUserAnswerOutputSchema>;

const SYSTEM = "You are a study assistant that validates user answers to questions.";

const USER_PROMPT = (input: ValidateUserAnswerInput) =>
  `Evaluate whether the user's answer is correct by comparing it to the correct answer and the document content.

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

Return ONLY valid JSON in this exact format with no markdown:
{
  "isCorrect": true,
  "feedback": "your feedback here"
}`;

export async function validateUserAnswer(
  input: ValidateUserAnswerInput,
): Promise<ValidateUserAnswerOutput> {
  await enforceRateLimit(RateLimitPresets.answerValidation);
  // Streaming for faster first-byte — validation responses are small
  const raw = await callNimJsonStream(SYSTEM, USER_PROMPT(input), {
    maxOutputTokens: 512,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse validation response: ${
        error instanceof Error ? error.message : "unknown error"
      }. Response preview: ${raw.slice(0, 200)}`,
    );
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    typeof (parsed as { isCorrect?: unknown }).isCorrect !== "boolean" ||
    typeof (parsed as { feedback?: unknown }).feedback !== "string"
  ) {
    throw new Error(
      `Missing or invalid isCorrect/feedback fields. Response preview: ${raw.slice(0, 200)}`,
    );
  }
  return parsed as ValidateUserAnswerOutput;
}
