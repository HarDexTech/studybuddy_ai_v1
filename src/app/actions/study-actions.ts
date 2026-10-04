"use server";

import {
  answerDocumentQuestion,
  type AnswerDocumentQuestionOutput,
} from "@/ai/flows/answer-document-question";
import { getDocumentById } from "@/lib/storage";
import { retrieveTestContext } from "@/ai/rag";
import { z } from "zod";

export type { AnswerDocumentQuestionOutput };

const AskDocumentQuestionInputSchema = z.object({
  documentId: z.string().trim().min(1, "Document ID is required."),
  question: z.string().trim().min(1, "A question is required.").max(2000),
});

export type AskDocumentQuestionInput = z.infer<
  typeof AskDocumentQuestionInputSchema
>;

/**
 * Application entry point for document Q&A.
 *
 * UI components call this action instead of importing an AI flow directly.
 * Provider selection, rate limiting, and response validation remain server-side.
 */
export async function askDocumentQuestion(
  input: AskDocumentQuestionInput,
): Promise<AnswerDocumentQuestionOutput> {
  const validatedInput = AskDocumentQuestionInputSchema.parse(input);
  await getDocumentById(validatedInput.documentId);
  const documentContent = await retrieveTestContext(validatedInput.question, {
    docId: validatedInput.documentId,
    limit: 8,
  });
  if (!documentContent) {
    throw new Error("DOCUMENT_CONTEXT_UNAVAILABLE: document is not indexed yet.");
  }
  return answerDocumentQuestion({
    documentContent,
    question: validatedInput.question,
  });
}
