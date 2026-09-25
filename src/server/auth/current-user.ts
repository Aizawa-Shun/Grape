import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { AppError } from "@/core/errors";
import { db } from "@/db/client";
import type { User } from "@/db/schema";
import { currentUserId } from "@/server/context";
import { SESSION_COOKIE } from "@/server/session";

export type { User };

/**
 * Who is asking.
 *
 * One verifier, two entry points: API routes go through `sessionUserIdFor`,
 * which reads the request it was handed, and server components go through
 * `currentUser`, which reads the ambient request. Both check the same
 * Firebase session cookie the same way, so a page and the endpoint behind it
 * cannot disagree about who is signed in.
 *
 * This is the real check. The Edge proxy only looks for the cookie's presence
 * to send signed-out browsers to /login — it cannot run the Admin SDK — so
 * every page and route verifies here, in Node, before reading anything.
 */

function readCookie(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

/**
 * The uid a session cookie belongs to, or undefined when it is missing,
 * expired, revoked, or not a Firebase session at all.
 *
 * `checkRevoked: true` costs a lookup per request, and buys what signing out
 * promises: api/auth/logout revokes the account's sessions, so a copied
 * cookie stops working everywhere, not just in the browser that signed out.
 */
export async function verifySessionCookie(cookie: string | undefined): Promise<string | undefined> {
  if (!cookie) return undefined;
  try {
    const { firebaseAuth } = await import("@/db/firebase");
    const decoded = await firebaseAuth().verifySessionCookie(cookie, true);
    return decoded.uid;
  } catch {
    return undefined;
  }
}

/**
 * The cookie's account, verified but not loaded. Takes the request rather
 * than reading `next/headers`, because the route wrapper is handed one and
 * because a handler that can only run inside Next's request store cannot be
 * called from a test.
 */
export async function sessionUserIdFor(request: Request): Promise<string | undefined> {
  return verifySessionCookie(readCookie(request.headers.get("cookie"), SESSION_COOKIE));
}

/**
 * React's `cache` collapses the repeat calls a page makes while rendering into
 * a single verification and lookup.
 *
 * A valid session whose account has no Grape document — one removed from
 * Firestore, or never enrolled — is a signed-out reader, not an error.
 */
export const currentUser = cache(async (): Promise<User | null> => {
  const uid = await verifySessionCookie((await cookies()).get(SESSION_COOKIE)?.value);
  if (!uid) return null;
  return db.users.get(uid);
});

/**
 * The account id an API route is running for, from the scope the route wrapper
 * opened. No cookie parsing — the verification already happened once at the
 * edge of the request.
 */
export function requireUserId(): string {
  const userId = currentUserId();
  if (!userId) throw new AppError("UNAUTHORIZED", "No session on a route that requires one");
  return userId;
}

/** For server components. Sends the reader to /login rather than throwing. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** The same check for route handlers, which answer a `fetch` with a 401 rather than a redirect. */
export async function requireApiUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AppError("UNAUTHORIZED", "No session on a route that requires one");
  return user;
}
