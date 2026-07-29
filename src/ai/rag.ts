'use server';

import { sql } from '@/lib/db';

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < cleaned.length) {
    let end = start + chunkSize;

    if (end >= cleaned.length) {
      chunks.push(cleaned.slice(start));
      break;
    }

    const boundary = cleaned.lastIndexOf('\n', end);
    const period = cleaned.lastIndexOf('. ', end);
    const breakAt = Math.max(boundary, period);
    if (breakAt > start + chunkSize / 2) {
      end = breakAt + 1;
    }

    chunks.push(cleaned.slice(start, end));
    start = end - overlap;
  }

  return chunks;
}

export async function indexDocument(docId: string, userId: string, text: string): Promise<void> {
  const chunks = chunkText(text);

  for (let i = 0; i < chunks.length; i++) {
    await sql`
      INSERT INTO document_chunks (user_id, doc_id, chunk_index, content)
      VALUES (${userId}, ${docId}, ${i}, ${chunks[i]})
      ON CONFLICT DO NOTHING
    `;
  }

  console.log(`[rag] indexed ${chunks.length} chunks for doc=${docId}`);
}

export async function deleteDocumentChunks(docId: string): Promise<void> {
  await sql`DELETE FROM document_chunks WHERE doc_id = ${docId}`;
}

export interface ChunkResult {
  content: string;
  chunkIndex: number;
  docId: string;
}

export async function searchChunks(
  query: string,
  userId: string,
  options: { docId?: string; limit?: number } = {},
): Promise<ChunkResult[]> {
  const limit = options.limit ?? 5;

  let rows: { content: string; chunk_index: number; doc_id: string }[];

  if (options.docId) {
    rows = await sql`
      SELECT content, chunk_index, doc_id
      FROM document_chunks
      WHERE user_id = ${userId}
        AND doc_id = ${options.docId}
        AND tsv_content @@ plainto_tsquery('english', ${query})
      ORDER BY ts_rank(tsv_content, plainto_tsquery('english', ${query})) DESC
      LIMIT ${limit}
    ` as any;
  } else {
    rows = await sql`
      SELECT content, chunk_index, doc_id
      FROM document_chunks
      WHERE user_id = ${userId}
        AND tsv_content @@ plainto_tsquery('english', ${query})
      ORDER BY ts_rank(tsv_content, plainto_tsquery('english', ${query})) DESC
      LIMIT ${limit}
    ` as any;
  }

  // If full-text search returns nothing, fall back to random chunks
  if (!rows || rows.length === 0) {
    if (options.docId) {
      rows = await sql`
        SELECT content, chunk_index, doc_id
        FROM document_chunks
        WHERE user_id = ${userId} AND doc_id = ${options.docId}
        ORDER BY RANDOM()
        LIMIT ${limit}
      ` as any;
    } else {
      rows = await sql`
        SELECT content, chunk_index, doc_id
        FROM document_chunks
        WHERE user_id = ${userId}
        ORDER BY RANDOM()
        LIMIT ${limit}
      ` as any;
    }
  }

  return (rows || []).map((r) => ({
    content: r.content,
    chunkIndex: r.chunk_index,
    docId: r.doc_id,
  }));
}

export async function buildContext(
  query: string,
  userId: string,
  options: { docId?: string; limit?: number } = {},
): Promise<string> {
  const results = await searchChunks(query, userId, options);
  if (results.length === 0) return '';
  return results
    .map((r, i) => `[Chunk ${i + 1}]\n${r.content}`)
    .join('\n\n');
}

export async function retrieveTestContext(
  query: string,
  options: { limit?: number } = {},
): Promise<string> {
  const { requireUserId } = await import('@/lib/auth');
  const userId = await requireUserId();
  return buildContext(query, userId, options);
}
