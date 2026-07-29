import { auth, clerkClient } from "@clerk/nextjs/server";

/**
 * Server-side auth helpers built on Clerk.
 *
 * Clerk stores user/session state in its own hosted service — our Neon (Postgres)
 * DB only stores app-owned data (documents, test progress, rate-limit buckets)
 * keyed by the Clerk user id returned below.
 */

export { auth };

/**
 * Returns the Clerk user id for the current request, or null if not signed in.
 * Use this for read paths the client may invoke before authentication
 * (graceful empty state).
 */
export async function getUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}

/**
 * Returns the Clerk user id, throwing `AUTH_REQUIRED` when unauthenticated.
 * Use for mutation paths that must require a session.
 */
export async function requireUserId(): Promise<string> {
  const id = await getUserId();
  if (!id) {
    throw new Error("AUTH_REQUIRED: sign in to manage saved documents.");
  }
  return id;
}
