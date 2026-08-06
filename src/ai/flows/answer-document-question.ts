"use server";
/**
 * @fileOverview Answer a question about the document content.
 */

import { callJson } from "@/ai/provider";
import { RateLimitPresets, enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const AnswerDocumentQuestionInputSchema = z.object({
  documentContent: z
    .string()
    .describe("The text content of the study document."),
  question: z.string().describe("The question to answer about the document."),
});
export type AnswerDocumentQuestionInput = z.infer<
  typeof AnswerDocumentQuestionInputSchema
>;

const AnswerDocumentQuestionOutputSchema = z.object({
  answer: z
    .string()
    .describe("The answer to the question based on the document content."),
});
export type AnswerDocumentQuestionOutput = z.infer<
  typeof AnswerDocumentQuestionOutputSchema
>;

const SYSTEM = "You are a study assistant that answers questions about document content.";

const USER_PROMPT = (input: AnswerDocumentQuestionInput) =>
  `Based on the document content provided below, answer the following question accurately and concisely.

Question: ${input.question}

Document Content:
\`\`\`
${input.documentContent}
\`\`\`

Provide a clear, accurate answer based on the document. Return ONLY valid JSON in this exact format with no markdown:
{
  "answer": "your answer here"
}`;

export async function answerDocumentQuestion(
  input: AnswerDocumentQuestionInput,
): Promise<AnswerDocumentQuestionOutput> {
  await enforceRateLimit(RateLimitPresets.qna);
  return callJson(SYSTEM, USER_PROMPT(input), (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Failed to parse answer response: ${
          error instanceof Error ? error.message : "unknown error"
        }. Response preview: ${raw.slice(0, 200)}`,
      );
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      typeof (parsed as { answer?: unknown }).answer !== "string"
    ) {
      throw new Error(
        `Missing or invalid "answer" field. Response preview: ${raw.slice(0, 200)}`,
      );
    }
    return parsed as AnswerDocumentQuestionOutput;
  });
}
