/**
 * One-off schema migration runner for the Neon (Postgres) database.
 *
 * Usage: `npm run migrate`
 *
 * Reads `DATABASE_URL` (prefer the direct / unpooled connection string for
 * DDL — set it as DATABASE_URL or override with DATABASE_URL_DIRECT), executes
 * the idempotent `SCHEMA_DDL` from `db.ts`, and exits.
 *
 * Safe to run repeatedly — all statements use `CREATE TABLE / INDEX IF NOT EXISTS`.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { SCHEMA_DDL } from "../lib/db";

async function main(): Promise<void> {
  const connectionString =
    process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error(
      "✖ DATABASE_URL (or DATABASE_URL_DIRECT) is not set. Add your Neon " +
        "connection string to .env before running migrations.",
    );
    process.exit(1);
  }

  console.log("→ Connecting to Neon and applying schema…");
  const sql = neon(connectionString);

  // Migrate document_chunks from vector(1024) to tsvector (DeepSeek retired
  // its embedding model). Safe — chunks are regenerated on upload.
  const hasOldSchema = await sql.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'document_chunks' AND column_name = 'embedding'`,
    [],
  );
  if (hasOldSchema.length > 0) {
    console.log("→ Migrating document_chunks schema (vector → tsvector)…");
    await sql.query(`DROP TABLE IF EXISTS document_chunks CASCADE;`, []);
  }

  // Migrate summaries from JSONB to TEXT. Safe — cached summaries regenerate.
  const summaryJsonb = await sql.query(
    `SELECT data_type FROM information_schema.columns
     WHERE table_name = 'summaries' AND column_name = 'summary' AND data_type = 'jsonb'`,
    [],
  );
  if (summaryJsonb.length > 0) {
    console.log("→ Migrating summaries (jsonb → text)…");
    await sql.query(`TRUNCATE TABLE summaries;`, []);
    await sql.query(`ALTER TABLE summaries ALTER COLUMN summary TYPE TEXT;`, []);
  }

  // Add structured_text column to documents (markdown structuring pass).
  const hasStructuredColumn = await sql.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'documents' AND column_name = 'structured_text'`,
    [],
  );
  if (hasStructuredColumn.length === 0) {
    console.log("→ Adding structured_text column to documents…");
    await sql.query(`ALTER TABLE documents ADD COLUMN structured_text TEXT;`, []);
  }

  // SCHEMA_DDL contains multiple statements. The neon() tagged template
  // treats interpolated values as bind parameters, but DDL (CREATE TABLE, etc.)
  // cannot be parameterized. Instead we use neon()'s `.query()` method, which
  // accepts a raw SQL string and a params array — passing an empty params array
  // sends the statement as-is with no bind parameters.
  const statements = SCHEMA_DDL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await sql.query(`${stmt};`, []);
  }

  console.log(
    "✓ Schema applied. Tables: documents, document_chunks (full-text search), test_progress, rate_limit_buckets, past_question_sets, summaries.",
  );
}

main().catch((error) => {
  console.error("✖ Migration failed:", error);
  process.exit(1);
});
