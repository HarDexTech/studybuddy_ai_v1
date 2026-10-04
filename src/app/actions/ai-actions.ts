"use server";

import {
  analyzePastQuestionTopics as analyzePastQuestionTopicsFlow,
  type AnalyzePastQuestionTopicsInput,
  type AnalyzePastQuestionTopicsOutput,
} from "@/ai/flows/analyze-past-question-topics";
import {
  explainQuestion as explainQuestionFlow,
  type ExplainQuestionInput,
  type ExplainQuestionOutput,
} from "@/ai/flows/explain-question";
import {
  extractTopicSection as extractTopicSectionFlow,
  type ExtractTopicSectionInput,
  type ExtractTopicSectionOutput,
} from "@/ai/flows/extract-topic-section";
import {
  generateBatchTestQuestions as generateBatchTestQuestionsFlow,
  type GenerateBatchTestQuestionsInput,
  type GenerateBatchTestQuestionsOutput,
} from "@/ai/flows/generate-batch-test-questions";
import {
  generateCrossDocumentQuestions as generateCrossDocumentQuestionsFlow,
  type GenerateCrossDocumentQuestionsInput,
  type GenerateCrossDocumentQuestionsOutput,
} from "@/ai/flows/generate-cross-document-questions";
import { abandonStudySession, completeStudySession, createStudySession, getDocumentById, getMultipleRecentDocuments, saveStudyAnswer, updateStudySession } from "@/lib/storage";
import { requireUserId } from "@/lib/auth";
import { sql } from "@/lib/db";
import { retrieveTestContext } from "@/ai/rag";
import {
  structureDocument as structureDocumentFlow,
} from "@/ai/flows/structure-document";
import {
  validateUserAnswer as validateUserAnswerFlow,
  type ValidateUserAnswerInput,
  type ValidateUserAnswerOutput,
} from "@/ai/flows/validate-user-answer";

export type { ValidateUserAnswerOutput };

export async function createStudySessionAction(
  documentIds: string[],
  settings: import("@/lib/types").TestSettings,
  questions: import("@/lib/types").Question[],
): Promise<string> {
  return createStudySession(documentIds, settings, questions);
}

export async function updateStudySessionAction(
  sessionId: string,
  progress: Parameters<typeof updateStudySession>[1],
): Promise<void> {
  return updateStudySession(sessionId, progress);
}

export async function completeStudySessionAction(sessionId: string): Promise<void> {
  return completeStudySession(sessionId);
}

export async function abandonStudySessionAction(sessionId: string): Promise<void> {
  return abandonStudySession(sessionId);
}

export async function analyzePastQuestionTopics(
  input: AnalyzePastQuestionTopicsInput,
): Promise<AnalyzePastQuestionTopicsOutput> {
  return analyzePastQuestionTopicsFlow(input);
}

export async function explainQuestion(
  input: ExplainQuestionInput,
  documentId: string,
): Promise<ExplainQuestionOutput> {
  await getDocumentById(documentId);
  const documentContent = await retrieveTestContext(
    `${input.question} ${input.correctAnswer}`,
    { docId: documentId, limit: 8 },
  );
  if (!documentContent) {
    throw new Error("DOCUMENT_CONTEXT_UNAVAILABLE: document is not indexed yet.");
  }
  return explainQuestionFlow({ ...input, documentContent });
}

export async function extractTopicSection(
  input: ExtractTopicSectionInput,
): Promise<ExtractTopicSectionOutput> {
  return extractTopicSectionFlow(input);
}

export async function generateBatchTestQuestions(
  input: GenerateBatchTestQuestionsInput,
  documentId: string,
): Promise<GenerateBatchTestQuestionsOutput> {
  await getDocumentById(documentId);
  const query = [
    input.priorityTopics?.join(" "),
    "key concepts definitions principles facts examples",
  ]
    .filter(Boolean)
    .join(" ");
  const documentContent = await retrieveTestContext(query, {
    docId: documentId,
    limit: 12,
  });
  if (!documentContent) {
    throw new Error("DOCUMENT_CONTEXT_UNAVAILABLE: document is not indexed yet.");
  }
  return generateBatchTestQuestionsFlow({ ...input, documentContent });
}

export async function generateCrossDocumentQuestions(
  input: GenerateCrossDocumentQuestionsInput,
  documentIds: string[],
): Promise<GenerateCrossDocumentQuestionsOutput> {
  const documents = await getMultipleRecentDocuments(documentIds);
  if (documents.length !== documentIds.length) {
    throw new Error(
      "DOCUMENT_ACCESS_DENIED: one or more documents are unavailable.",
    );
  }

  const query = "key concepts definitions principles facts examples";
  const contextByDocument = await Promise.all(
    documentIds.map(async (id, index) => ({
      name: documents[index].name,
      content: await retrieveTestContext(query, { docId: id, limit: 6 }),
    })),
  );
  return generateCrossDocumentQuestionsFlow({
    ...input,
    documents: contextByDocument,
  });
}

export async function structureDocument(rawText: string): Promise<string> {
  return structureDocumentFlow(rawText);
}

export async function validateUserAnswer(
  input: ValidateUserAnswerInput,
  sessionId: string,
  questionIndex: number,
): Promise<ValidateUserAnswerOutput> {
  const userId = await requireUserId();
  const sessionRows = (await sql`
    SELECT document_ids FROM study_sessions
    WHERE id = ${sessionId} AND user_id = ${userId}
    LIMIT 1
  `) as { document_ids: string }[];
  if (sessionRows.length === 0) throw new Error("STUDY_SESSION_ACCESS_DENIED");
  const documentIds = JSON.parse(sessionRows[0].document_ids) as string[];
  const documents = await getMultipleRecentDocuments(documentIds);
  if (documents.length !== documentIds.length) throw new Error("DOCUMENT_ACCESS_DENIED");

  const documentContent = await retrieveTestContext(
    `${input.question} ${input.correctAnswer}`,
    { docIds: documentIds, limit: 8 },
  );
  if (!documentContent) {
    throw new Error("DOCUMENT_CONTEXT_UNAVAILABLE: document is not indexed yet.");
  }
  const result = await validateUserAnswerFlow({
    ...input,
    documentContent,
  });
  await saveStudyAnswer(sessionId, questionIndex, input.userAnswer, result.score, result.feedback);
  return result;
}
