"use server";

// -----------------------------------------------------------------------------
// Document + test-progress storage backed by Neon (Postgres), keyed by the
// signed-in user id. All functions are server actions; client components call
// them over the wire and `await` results.
// -----------------------------------------------------------------------------

import { getUserId, requireUserId } from "./auth";
import { sql } from "./db";
import type { CachedDocument, StoredTestProgress, PastQuestionSet } from "./types";

const MAX_RECENT_DOCS = 10;
const MAX_STORED_DOC_TEXT_CHARS = 200_000;

interface DocRow {
  id: string;
  user_id: string | null;
  name: string;
  type: string;
  size: number;
  last_modified: number;
  text: string;
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
  };
}

export async function getRecentDocuments(): Promise<CachedDocument[]> {
  const userId = await getUserId();
  if (!userId) return [];
  try {
    const rows = (await sql`
      SELECT id, user_id, name, type, size, last_modified, text, created_at
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
  try {
    const trimmedText =
      doc.text.length > MAX_STORED_DOC_TEXT_CHARS
        ? doc.text.slice(0, MAX_STORED_DOC_TEXT_CHARS)
        : doc.text;
    await sql`
      INSERT INTO documents (id, user_id, name, type, size, last_modified, text)
      VALUES (${doc.id}, ${userId}, ${doc.name}, ${doc.type}, ${doc.size}, ${doc.lastModified}, ${trimmedText})
      ON CONFLICT(id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        size = EXCLUDED.size,
        last_modified = EXCLUDED.last_modified,
        text = EXCLUDED.text,
        created_at = floor(extract(epoch from now()))::bigint
    `;

  } catch (error) {
    console.error("Failed to add recent document:", error);
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
      SELECT id, user_id, name, type, size, last_modified, text, created_at
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
