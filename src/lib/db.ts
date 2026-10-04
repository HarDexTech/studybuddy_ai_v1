import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// -----------------------------------------------------------------------------
// Neon (serverless Postgres) connection.
//
// Uses the `neon()` HTTP driver — ideal for serverless / edge functions because
// it opens a fresh fetch-based query per call (no persistent connection pool to
// exhaust). The `sql` tagged-template is async and returns rows as plain objects.
//
// The client is cached on `globalThis` so dev hot-reloads reuse the same
// instance instead of creating a new one per request.
// -----------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  // Fail loudly at import time so misconfigurations surface immediately rather
  // than as silent runtime failures in server actions.
  throw new Error(
    "DATABASE_URL is not set. Add your Neon pooled connection string to .env " +
      "(e.g. DATABASE_URL=postgres://user:pass@ep-xxx-pooler.region.aws.neon.tech/db?sslmode=require).",
  );
}

declare global {
  // eslint-disable-next-line no-var
  var __studybuddySql: NeonQueryFunction<false, false> | undefined;
}

/**
 * Async `sql` tagged-template query function backed by Neon's HTTP driver.
 *
 * Usage: `const rows = await sql\`SELECT * FROM documents WHERE user_id = ${userId}\`;`
 */
export const sql: NeonQueryFunction<false, false> =
  globalThis.__studybuddySql ?? neon(DATABASE_URL);

if (process.env.NODE_ENV !== "production") {
  globalThis.__studybuddySql = sql;
}

/**
 * Idempotent Postgres schema for the Neon database. Run via `npm run migrate`
 * (see `src/lib/migrate.ts`) or directly in the Neon SQL editor. Kept here as
 * the single source of truth for the schema.
 *
 * Auth is handled by Clerk (user/session state lives in Clerk's hosted service).
 * This DB only stores app-owned data, keyed by the Clerk user id.
 */
export const SCHEMA_DDL = /* sql */ `
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size BIGINT NOT NULL,
    last_modified BIGINT NOT NULL,
    text TEXT NOT NULL,
    structured_text TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    processing_error TEXT,
    created_at BIGINT NOT NULL DEFAULT floor(extract(epoch from now()))::bigint
  );

  ALTER TABLE documents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready';
  ALTER TABLE documents ADD COLUMN IF NOT EXISTS processing_error TEXT;

  CREATE INDEX IF NOT EXISTS idx_documents_user ON documents (user_id);
  CREATE INDEX IF NOT EXISTS idx_documents_created ON documents (created_at DESC);

  CREATE TABLE IF NOT EXISTS document_chunks (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    tsv_content tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    created_at BIGINT NOT NULL DEFAULT floor(extract(epoch from now()))::bigint
  );

  CREATE INDEX IF NOT EXISTS idx_chunks_doc ON document_chunks (doc_id);
  CREATE INDEX IF NOT EXISTS idx_chunks_user ON document_chunks (user_id);
  CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON document_chunks USING GIN (tsv_content);

  CREATE TABLE IF NOT EXISTS test_progress (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT UNIQUE,
    doc_signature TEXT,
    settings_signature TEXT,
    payload TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS study_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    document_ids TEXT NOT NULL,
    settings TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    progress TEXT,
    created_at BIGINT NOT NULL DEFAULT floor(extract(epoch from now()))::bigint,
    completed_at BIGINT
  );

  CREATE TABLE IF NOT EXISTS study_questions (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
    question_index INT NOT NULL,
    payload TEXT NOT NULL,
    created_at BIGINT NOT NULL DEFAULT floor(extract(epoch from now()))::bigint,
    UNIQUE(session_id, question_index)
  );

  CREATE TABLE IF NOT EXISTS study_answers (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES study_questions(id) ON DELETE CASCADE,
    user_answer TEXT NOT NULL,
    score INT NOT NULL,
    feedback TEXT NOT NULL,
    created_at BIGINT NOT NULL DEFAULT floor(extract(epoch from now()))::bigint,
    UNIQUE(session_id, question_id)
  );

  ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS progress TEXT;

  CREATE INDEX IF NOT EXISTS idx_study_sessions_user ON study_sessions (user_id);
  CREATE INDEX IF NOT EXISTS idx_study_questions_session ON study_questions (session_id);
  CREATE INDEX IF NOT EXISTS idx_study_answers_session ON study_answers (session_id);

  CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    key TEXT PRIMARY KEY NOT NULL,
    count BIGINT NOT NULL,
    window_start BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS past_question_sets (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    uploaded_at BIGINT NOT NULL DEFAULT floor(extract(epoch from now()))::bigint
  );

  CREATE INDEX IF NOT EXISTS idx_past_questions_user ON past_question_sets (user_id);
  CREATE INDEX IF NOT EXISTS idx_past_questions_uploaded ON past_question_sets (uploaded_at DESC);

  CREATE TABLE IF NOT EXISTS summaries (
    sig TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    summary TEXT NOT NULL,
    created_at BIGINT NOT NULL DEFAULT floor(extract(epoch from now()))::bigint
  );

  CREATE INDEX IF NOT EXISTS idx_summaries_user ON summaries (user_id);
`;
