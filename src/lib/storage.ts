"use server";

// -----------------------------------------------------------------------------
// Document + test-progress storage backed by Neon (Postgres), keyed by the
// signed-in user id. All functions are server actions; client components call
// them over the wire and `await` results.
// -----------------------------------------------------------------------------

import { getUserId, requireUserId } from "./auth";
import { sql } from "./db";
import type { CachedDocument, StoredTestProgress, PastQuestionSet, Question, TestSettings } from "./types";
import { indexDocument } from "@/ai/rag";
import { after } from "next/server";

const MAX_RECENT_DOCS = 10;
const MAX_STORED_DOC_TEXT_CHARS = 200_000;

export async function createStudySession(
  documentIds: string[],
  settings: TestSettings,
  questions: Question[],
): Promise<string> {
  const userId = await requireUserId();
  const documents = await getMultipleRecentDocuments(documentIds);
  if (documents.length !== documentIds.length) {
    throw new Error("DOCUMENT_ACCESS_DENIED: session document unavailable.");
  }

  const sessionId = crypto.randomUUID();
  await sql`
    INSERT INTO study_sessions (id, user_id, document_ids, settings)
    VALUES (${sessionId}, ${userId}, ${JSON.stringify(documentIds)}, ${JSON.stringify(settings)})
  `;
  for (const [questionIndex, question] of questions.entries()) {
    await sql`
      INSERT INTO study_questions (id, session_id, question_index, payload)
      VALUES (${crypto.randomUUID()}, ${sessionId}, ${questionIndex}, ${JSON.stringify(question)})
    `;
  }
  return sessionId;
}

export async function loadActiveStudySession(): Promise<StoredTestProgress | null> {
  const userId = await getUserId();
  if (!userId) return null;
  const rows = (await sql`
    SELECT id, document_ids, settings, progress
    FROM study_sessions
    WHERE user_id = ${userId} AND status = 'active' AND progress IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `) as { id: string; document_ids: string; settings: string; progress: string }[];
  if (rows.length === 0) return null;

  const row = rows[0];
  const progress = JSON.parse(row.progress) as StoredTestProgress;
  const settings = JSON.parse(row.settings) as TestSettings;
  const documentIds = JSON.parse(row.document_ids) as string[];
  const documents = await getMultipleRecentDocuments(documentIds);
  if (documents.length === 0) return null;
  const primary = documents[0];

  return {
    ...progress,
    sessionId: row.id,
    settings,
    documentInfo: {
      text: primary.text,
      file: { name: primary.name, type: primary.type, size: primary.size },
    },
    effectiveDocumentText: primary.structuredText ?? primary.text,
  };
}

export async function saveStudyAnswer(
  sessionId: string,
  questionIndex: number,
  userAnswer: string,
  score: number,
  feedback: string,
): Promise<void> {
  const userId = await requireUserId();
  const rows = (await sql`
    SELECT q.id
    FROM study_questions q
    JOIN study_sessions s ON s.id = q.session_id
    WHERE q.session_id = ${sessionId}
      AND q.question_index = ${questionIndex}
      AND s.user_id = ${userId}
    LIMIT 1
  `) as { id: string }[];
  if (rows.length === 0) {
    throw new Error("STUDY_QUESTION_ACCESS_DENIED");
  }

  await sql`
    INSERT INTO study_answers (session_id, question_id, user_answer, score, feedback)
    VALUES (${sessionId}, ${rows[0].id}, ${userAnswer}, ${score}, ${feedback})
    ON CONFLICT(session_id, question_id) DO UPDATE SET
      user_answer = EXCLUDED.user_answer,
      score = EXCLUDED.score,
      feedback = EXCLUDED.feedback,
      created_at = floor(extract(epoch from now()))::bigint
  `;
}

export async function updateStudySession(
  sessionId: string,
  progress: {
    currentQuestionIndex: number;
    userAnswer: string;
    results: unknown[];
    currentResult: unknown;
    isAnswered: boolean;
    timeLeft: number | null;
    questions: Question[];
  },
): Promise<void> {
  const userId = await requireUserId();
  const sessionRows = (await sql`
    SELECT id FROM study_sessions
    WHERE id = ${sessionId} AND user_id = ${userId}
    LIMIT 1
  `) as { id: string }[];
  if (sessionRows.length === 0) throw new Error("STUDY_SESSION_ACCESS_DENIED");

  await sql`
    UPDATE study_sessions
    SET progress = ${JSON.stringify(progress)}
    WHERE id = ${sessionId} AND user_id = ${userId}
  `;

  for (const [questionIndex, question] of progress.questions.entries()) {
    await sql`
      INSERT INTO study_questions (id, session_id, question_index, payload)
      VALUES (${crypto.randomUUID()}, ${sessionId}, ${questionIndex}, ${JSON.stringify(question)})
      ON CONFLICT(session_id, question_index) DO UPDATE SET payload = EXCLUDED.payload
    `;
  }
}

export async function completeStudySession(sessionId: string): Promise<void> {
  const userId = await requireUserId();
  await sql`
    UPDATE study_sessions
    SET status = 'completed', completed_at = floor(extract(epoch from now()))::bigint
    WHERE id = ${sessionId} AND user_id = ${userId}
  `;
}

export async function abandonStudySession(sessionId: string): Promise<void> {
  const userId = await requireUserId();
  await sql`
    UPDATE study_sessions
    SET status = 'abandoned', completed_at = floor(extract(epoch from now()))::bigint
    WHERE id = ${sessionId} AND user_id = ${userId} AND status = 'active'
  `;
}

interface DocRow {
  id: string;
  user_id: string | null;
  name: string;
  type: string;
  size: number;
  last_modified: number;
  text: string;
  structured_text: string | null;
  status: 'processing' | 'ready' | 'failed';
  processing_error: string | null;
  created_at: number;
}

function toCachedDocument(row: DocRow): CachedDocument {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    size: row.size,
    lastModified: row.last_modified,
    text: row.text,
    structuredText: row.structured_text ?? undefined,
    status: row.status,
    processingError: row.processing_error ?? undefined,
  };
}

export async function getDocumentById(id: string): Promise<CachedDocument> {
  const userId = await requireUserId();
  const rows = (await sql`
    SELECT id, user_id, name, type, size, last_modified, text, structured_text, status, processing_error, created_at
    FROM documents
    WHERE id = ${id} AND user_id = ${userId}
    LIMIT 1
  `) as DocRow[];

  if (rows.length === 0) {
    throw new Error("DOCUMENT_NOT_FOUND: document does not exist.");
  }

  return toCachedDocument(rows[0]);
}

export async function getRecentDocuments(): Promise<CachedDocument[]> {
  const userId = await getUserId();
  if (!userId) return [];
  try {
    const rows = (await sql`
      SELECT id, user_id, name, type, size, last_modified, text, structured_text, status, processing_error, created_at
      FROM documents WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT ${MAX_RECENT_DOCS}
    `) as DocRow[];
    return rows.map(toCachedDocument);
  } catch (error) {
    console.error("Failed to get recent documents from Neon:", error);
    return [];
  }
}

export async function addRecentDocument(doc: CachedDocument): Promise<void> {
  const userId = await requireUserId();
  const trimmedText =
    doc.text.length > MAX_STORED_DOC_TEXT_CHARS
      ? doc.text.slice(0, MAX_STORED_DOC_TEXT_CHARS)
      : doc.text;
  const trimmedStructured =
    doc.structuredText && doc.structuredText.length > MAX_STORED_DOC_TEXT_CHARS
      ? doc.structuredText.slice(0, MAX_STORED_DOC_TEXT_CHARS)
      : doc.structuredText;
  try {
    await sql`
      INSERT INTO documents (id, user_id, name, type, size, last_modified, text, structured_text, status, processing_error)
      VALUES (${doc.id}, ${userId}, ${doc.name}, ${doc.type}, ${doc.size}, ${doc.lastModified}, ${trimmedText}, ${trimmedStructured ?? null}, 'processing', NULL)
      ON CONFLICT(id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        size = EXCLUDED.size,
        last_modified = EXCLUDED.last_modified,
        text = EXCLUDED.text,
        structured_text = EXCLUDED.structured_text,
        status = 'processing',
        processing_error = NULL,
        created_at = floor(extract(epoch from now()))::bigint
    `;

    const ragText = trimmedStructured ?? trimmedText;
    await indexDocument(doc.id, userId, ragText);
    await sql`
      UPDATE documents
      SET status = 'ready', processing_error = NULL
      WHERE id = ${doc.id} AND user_id = ${userId}
    `;

    // Pre-generate summary in background so it's cached before user clicks "Summarize"
    after(async () => {
      const { generateDocumentSummary } = await import("@/ai/flows/generate-document-summary");
      await generateDocumentSummary({
        documents: [{ name: doc.name, content: trimmedText, structuredText: trimmedStructured }],
      }).catch((err) =>
        console.error("Background summary generation failed:", err),
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DOCUMENT_PROCESSING_FAILED";
    await sql`
      UPDATE documents
      SET status = 'failed', processing_error = ${message}
      WHERE id = ${doc.id} AND user_id = ${userId}
    `.catch((statusError) =>
      console.error("Failed to record document processing failure:", statusError),
    );
    throw new Error(`DOCUMENT_PROCESSING_FAILED: ${message}`);
  }
}

export async function removeRecentDocument(id: string): Promise<void> {
  const userId = await requireUserId();
  try {
    await sql`DELETE FROM documents WHERE id = ${id} AND user_id = ${userId}`;
  } catch (error) {
    console.error("Failed to remove recent document:", error);
  }
}

export async function clearAllRecentDocuments(): Promise<void> {
  const userId = await requireUserId();
  try {
    await sql`DELETE FROM documents WHERE user_id = ${userId}`;
  } catch (error) {
    console.error("Failed to clear recent documents:", error);
  }
}

export async function getMultipleRecentDocuments(
  ids: string[],
): Promise<CachedDocument[]> {
  const userId = await requireUserId();
  if (ids.length === 0) return [];
  try {
    // Postgres `= ANY($n::text[])` replaces SQLite's `json_each(?)`.
    // The neon() driver accepts JS arrays directly as a parameter.
    const rows = (await sql`
      SELECT id, user_id, name, type, size, last_modified, text, structured_text, status, processing_error, created_at
      FROM documents WHERE user_id = ${userId} AND id = ANY(${ids}::text[])
    `) as DocRow[];
    // Preserve caller's order.
    const byId = new Map(rows.map((r) => [r.id, toCachedDocument(r)]));
    return ids
      .map((id) => byId.get(id))
      .filter((d): d is CachedDocument => Boolean(d));
  } catch (error) {
    console.error("Failed to get multiple recent documents:", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Test progress persistence
// ---------------------------------------------------------------------------

export async function saveTestProgress(
  progress: StoredTestProgress,
): Promise<void> {
  const userId = await requireUserId();
  try {
    await sql`
      INSERT INTO test_progress (user_id, doc_signature, settings_signature, payload, updated_at)
      VALUES (${userId}, ${progress.docSignature ?? null}, ${progress.settingsSignature ?? null}, ${JSON.stringify(progress)}, ${Date.now()})
      ON CONFLICT(user_id) DO UPDATE SET
        doc_signature = EXCLUDED.doc_signature,
        settings_signature = EXCLUDED.settings_signature,
        payload = EXCLUDED.payload,
        updated_at = EXCLUDED.updated_at
    `;
  } catch (error) {
    console.error("Failed to persist test progress:", error);
  }
}

export async function loadTestProgress(): Promise<StoredTestProgress | null> {
  const userId = await getUserId();
  if (!userId) return null;
  try {
    const rows = (await sql`
      SELECT payload FROM test_progress WHERE user_id = ${userId}
    `) as { payload: string }[];
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].payload) as StoredTestProgress;
  } catch (error) {
    console.error("Failed to load test progress:", error);
    return null;
  }
}

export async function clearTestProgress(): Promise<void> {
  const userId = await requireUserId();
  try {
    await sql`DELETE FROM test_progress WHERE user_id = ${userId}`;
  } catch (error) {
    console.error("Failed to clear test progress:", error);
  }
}

// ---------------------------------------------------------------------------
// Past question sets storage
// ---------------------------------------------------------------------------

export async function getPastQuestionSets(): Promise<PastQuestionSet[]> {
  const userId = await getUserId();
  if (!userId) return [];
  try {
    const rows = (await sql`
      SELECT id, user_id, name, text, uploaded_at
      FROM past_question_sets WHERE user_id = ${userId}
      ORDER BY uploaded_at DESC LIMIT 20
    `) as { id: string; user_id: string; name: string; text: string; uploaded_at: number }[];
    return rows.map((r) => ({ id: r.id, name: r.name, text: r.text, uploadedAt: r.uploaded_at }));
  } catch (error) {
    console.error("Failed to get past question sets:", error);
    return [];
  }
}

export async function addPastQuestionSet(set: PastQuestionSet): Promise<void> {
  const userId = await requireUserId();
  try {
    await sql`
      INSERT INTO past_question_sets (id, user_id, name, text, uploaded_at)
      VALUES (${set.id}, ${userId}, ${set.name}, ${set.text}, ${set.uploadedAt})
      ON CONFLICT(id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        name = EXCLUDED.name,
        text = EXCLUDED.text,
        uploaded_at = EXCLUDED.uploaded_at
    `;
  } catch (error) {
    console.error("Failed to add past question set:", error);
  }
}

export async function removePastQuestionSet(id: string): Promise<void> {
  const userId = await requireUserId();
  try {
    await sql`DELETE FROM past_question_sets WHERE id = ${id} AND user_id = ${userId}`;
  } catch (error) {
    console.error("Failed to remove past question set:", error);
  }
}

export async function getMultiplePastQuestionSets(ids: string[]): Promise<PastQuestionSet[]> {
  const userId = await getUserId();
  if (!userId || ids.length === 0) return [];
  try {
    const rows = (await sql`
      SELECT id, user_id, name, text, uploaded_at
      FROM past_question_sets WHERE user_id = ${userId} AND id = ANY(${ids}::text[])
    `) as { id: string; user_id: string; name: string; text: string; uploaded_at: number }[];
    const byId = new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, text: r.text, uploadedAt: r.uploaded_at }]));
    return ids.map((id) => byId.get(id)).filter((s): s is PastQuestionSet => Boolean(s));
  } catch (error) {
    console.error("Failed to get multiple past question sets:", error);
    return [];
  }
}

export async function getCachedSummary(sig: string): Promise<string | null> {
  const userId = await getUserId();
  if (!userId) return null;
  try {
    const rows = await sql`
      SELECT summary FROM summaries WHERE sig = ${sig} AND user_id = ${userId}
    `;
    if (!rows || rows.length === 0) return null;
    const raw = rows[0].summary;
    return typeof raw === 'string' ? raw : null;
  } catch (error) {
    console.error("Failed to get cached summary:", error);
    return null;
  }
}

export async function saveSummary(sig: string, summary: string): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;
  try {
    await sql`
      INSERT INTO summaries (sig, user_id, summary)
      VALUES (${sig}, ${userId}, ${summary})
      ON CONFLICT(sig) DO NOTHING
    `;
  } catch (error) {
    console.error("Failed to save summary:", error);
  }
}
