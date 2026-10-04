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

export type AnswerDocumentQuestionOutput = { answer: string };

const SYSTEM = "You are a study assistant that answers questions about document content.";

const USER_PROMPT = (input: AnswerDocumentQuestionInput) =>
  `Based on the document content provided below, answer the following question accurately and concisely.

Question: ${input.question}

Document Content:
\`\`\`
${input.documentContent}
\`\`\`

Provide a clear, accurate answer based on the document. Return only the answer
as plain text or Markdown. Do not include JSON, labels, or meta-commentary.
If the document does not contain enough information, say so clearly.`;

export async function answerDocumentQuestion(
  input: AnswerDocumentQuestionInput,
): Promise<AnswerDocumentQuestionOutput> {
  await enforceRateLimit(RateLimitPresets.qna);
  const answer = await callJson(
    SYSTEM,
    USER_PROMPT(input),
    (raw) => raw.trim(),
    { skipStripFences: true },
  );
  if (!answer) throw new Error("AI_EMPTY_ANSWER: the model returned no answer.");
  return { answer };
}
