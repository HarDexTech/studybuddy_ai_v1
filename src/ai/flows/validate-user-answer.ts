"use server";
/**
 * @fileOverview Validate a user's answer to a question — streaming for low latency.
 */

import { callJsonStream } from "@/ai/provider";
import { RateLimitPresets, enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { PASS_THRESHOLD } from "@/lib/types";

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
  score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      "A score from 0 to 100 reflecting how completely and correctly the answer addresses ALL parts of the question.",
    ),
  feedback: z.string().describe("Feedback on the user's answer."),
});
export type ValidateUserAnswerOutput = {
  isCorrect: boolean;
  score: number; // 0-100, partial credit
  feedback: string;
};

const SYSTEM =
  "You are a study assistant that validates user answers to questions and awards partial credit.";

const USER_PROMPT = (input: ValidateUserAnswerInput) =>
  `Evaluate the user's answer by comparing it to the correct answer and the document content.

If the provided correct answer is missing, empty, or unclear, first infer the best expected answer from the question.
When the document does not contain enough information, use reliable general subject knowledge to infer the expected answer.
Then grade the user's answer against that inferred expected answer.

Marking Mode: ${input.questionSource}
- If mode is "strict": require close factual alignment, key terminology, and high precision, but still award partial credit for covering the core concept while missing minor sub-details.
- If mode is "formed": allow semantically equivalent paraphrases and concept-level correctness even if wording differs.

Question: ${input.question}
User's Answer: ${input.userAnswer}
Correct Answer: ${input.correctAnswer}

Document Content:
\`\`\`
${input.documentContent}
\`\`\`

Grade the answer on a score from 0 to 100. Award partial credit: an answer that conveys the core concept but misses some sub-parts of the question should receive a high but not perfect score (e.g. 70-95). Only award 100 when the answer fully and accurately addresses every part of the question. Only award low scores (0-40) when the core meaning is wrong or missing.

Provide helpful feedback.

Return exactly two lines and nothing else:
SCORE<TAB>number from 0 to 100
FEEDBACK<TAB>brief helpful feedback on one line
Do not use JSON or Markdown in the response.`;

export async function validateUserAnswer(
  input: ValidateUserAnswerInput,
): Promise<ValidateUserAnswerOutput> {
  await enforceRateLimit(RateLimitPresets.answerValidation);
  // Streaming for faster first-byte — validation responses are small
  const raw = await callJsonStream(SYSTEM, USER_PROMPT(input), {
    maxOutputTokens: 512,
  });
  const scoreMatch = raw.match(/(?:^|\n)SCORE\s*[\t:|]\s*(\d+(?:\.\d+)?)/i);
  const feedbackMatch = raw.match(/(?:^|\n)FEEDBACK\s*[\t:|]\s*(.+)/i);
  const score = scoreMatch ? Number(scoreMatch[1]) : NaN;
  const feedback = feedbackMatch?.[1]?.trim();
  if (!Number.isFinite(score) || score < 0 || score > 100 || !feedback) {
    throw new Error(`Invalid compact grading response. Response preview: ${raw.slice(0, 200)}`);
  }
  return {
    isCorrect: score >= PASS_THRESHOLD,
    score,
    feedback,
  };
}
