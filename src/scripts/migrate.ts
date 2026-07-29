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
    "✓ Schema applied. Tables: documents, document_chunks (pgvector), test_progress, rate_limit_buckets, past_question_sets.",
  );
}

main().catch((error) => {
  console.error("✖ Migration failed:", error);
  process.exit(1);
});
