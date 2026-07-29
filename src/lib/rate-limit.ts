import { getUserId } from "./auth";
import { sql } from "./db";

// -----------------------------------------------------------------------------
// In-memory fixed-window rate limiter.
//
// Per-user buckets in a Map. No external infra. On a long-running Node process
// (self-hosted, `next start`) the buckets persist across requests until the
// process restarts. We also persist the bucket state to Neon (Postgres) so
// cold starts don't fully reset a user's quota between deploys.
// -----------------------------------------------------------------------------

export interface RateLimitOptions {
  /** Maximum number of actions allowed per window. */
  limit: number;
  /** Window duration in seconds. */
  windowSeconds: number;
  /** Optional prefix for the bucket key (e.g. "gen_TEST" vs "gen_SUMMARY"). */
  scope: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number; // epoch ms
}

interface Bucket {
  count: number;
  windowStart: number;
}

const MEMORY: Map<string, Bucket> = new Map();

async function readPersisted(key: string): Promise<Bucket | null> {
  try {
    const rows = (await sql`
      SELECT count, window_start FROM rate_limit_buckets WHERE key = ${key}
    `) as { count: number; window_start: number }[];
    if (rows.length === 0) return null;
    return { count: rows[0].count, windowStart: rows[0].window_start };
  } catch {
    return null;
  }
}

async function writePersisted(key: string, bucket: Bucket): Promise<void> {
  try {
    await sql`
      INSERT INTO rate_limit_buckets (key, count, window_start)
      VALUES (${key}, ${bucket.count}, ${bucket.windowStart})
      ON CONFLICT(key) DO UPDATE SET
        count = EXCLUDED.count,
        window_start = EXCLUDED.window_start
    `;
  } catch {
    // Ignore persistence errors — in-memory limiter still works.
  }
}

/**
 * Generic token-bucket check. Throws (with rate-limit metadata) when the
 * caller is over the limit. Returns the remaining limit info otherwise.
 */
export async function enforceRateLimit(
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const userId = await getUserId();
  if (!userId) {
    // Unauthenticated requests should already be blocked by middleware,
    // but be defensive: deny here rather than blow up.
    throw new Error("AUTH_REQUIRED: sign in to use this feature.");
  }

  const key = `${opts.scope}:${userId}`;
  const now = Date.now();
  const windowMs = opts.windowSeconds * 1000;

  // Start with the persisted bucket (if any) then apply in-memory updates.
  let bucket: Bucket = MEMORY.get(key) ??
    (await readPersisted(key)) ?? { count: 0, windowStart: now };

  if (now - bucket.windowStart >= windowMs) {
    bucket = { count: 0, windowStart: now };
  }

  if (bucket.count >= opts.limit) {
    const resetAt = bucket.windowStart + windowMs;
    const error = new Error(
      "RATE_LIMITED: You have hit the action rate limit. Please try again shortly.",
    );
    (error as Error & { rateLimit?: RateLimitResult }).rateLimit = {
      allowed: false,
      remaining: 0,
      limit: opts.limit,
      resetAt,
    };
    throw error;
  }

  bucket.count += 1;
  MEMORY.set(key, bucket);
  void writePersisted(key, bucket); // fire-and-forget — persistence is best-effort

  return {
    allowed: true,
    remaining: Math.max(0, opts.limit - bucket.count),
    limit: opts.limit,
    resetAt: bucket.windowStart + windowMs,
  };
}

/**
 * Convenience presets keyed by feature, so call sites stay short.
 */
export const RateLimitPresets = {
  testGeneration: { scope: "gen_TEST", limit: 30, windowSeconds: 60 },
  answerValidation: { scope: "val_ANSWER", limit: 120, windowSeconds: 60 },
  summary: { scope: "gen_SUMMARY", limit: 10, windowSeconds: 60 },
  qna: { scope: "qna_ASK", limit: 60, windowSeconds: 60 },
  explain: { scope: "qna_EXPLAIN", limit: 60, windowSeconds: 60 },
  extract: { scope: "extract_TOPIC", limit: 30, windowSeconds: 60 },
  crossDoc: { scope: "gen_CROSS_DOC", limit: 20, windowSeconds: 60 },
  topicAnalysis: { scope: "ana_TOPIC", limit: 10, windowSeconds: 120 },
} as const;
