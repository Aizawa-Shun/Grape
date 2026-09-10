import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { eq } from "drizzle-orm";

import { adoptPreAccountRows } from "@/core/auth/users";
import { AppError } from "@/core/errors";
import { db, schema } from "@/db/client";
import { currentUserId } from "@/server/context";
import { env } from "@/env";
import { NO_PASSWORD_LOGIN } from "@/server/auth/password";
import { DEV_USER_ID, SESSION_COOKIE, isLoopbackHost, readSession, sessionSecret } from "@/server/session";

export type User = typeof schema.users.$inferSelect;

/**
 * Who is asking.
 *
 * One verifier, two entry points: API routes go through `sessionUserIdFor`,
 * which reads the request it was handed, and server components go through
 * `currentUser`, which reads the ambient request. Both check the same signed
 * cookie the same way, so a page and the endpoint behind it cannot disagree
 * about who is logged in.
 */

/**
 * Exported for the three route handlers (login, register, the Google OAuth
 * callback) that issue a session outside of `currentUser`'s cache and so need
 * to answer this same question for themselves rather than duplicating the
 * dev-fallback rule a third time.
 */
export function secretFor(host: string | null | undefined): string | null {
  const devMode =
    !env.GRAPE_SESSION_SECRET &&
    process.env.NODE_ENV !== "production" &&
    isLoopbackHost(host);
  return sessionSecret(env.GRAPE_SESSION_SECRET, devMode);
}

function readCookie(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

/**
 * The cookie's claim about who this is, verified but not looked up.
 *
 * Takes the request rather than reading `next/headers`, because the route
 * wrapper is handed one and because a handler that can only run inside Next's
 * request store cannot be called from a test.
 *
 * Deliberately no database read: this runs on every request including
 * /api/collect, the ingest hot path, which has no business paying for a users
 * query per tracked event. Verifying an HMAC costs microseconds; reading the
 * row waits until something actually needs the account.
 */
export async function sessionUserIdFor(request: Request): Promise<string | undefined> {
  const secret = secretFor(request.headers.get("host"));
  if (!secret) return undefined;

  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  const session = await readSession(token, secret);
  return session.valid ? session.userId : undefined;
}

/**
 * React's `cache` collapses the repeat calls a page makes while rendering into
 * a single lookup, which is what makes it reasonable for every server
 * component needing an owner to just ask.
 */
export const currentUser = cache(async (): Promise<User | null> => {
  const secret = secretFor((await headers()).get("host"));
  if (!secret) return null;

  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value, secret);
  if (!session.valid) return null;

  const found = await db.query.users.findFirst({ where: eq(schema.users.id, session.userId) });
  if (found) return found;

  // A signed token naming an account that does not exist — a deleted user, or
  // the development account on its first request.
  return session.userId === DEV_USER_ID ? await createDeveloperAccount() : null;
});

/**
 * The account id an API route is running for, from the scope the route wrapper
 * opened. No database read and no cookie parsing — the verification already
 * happened once at the edge of the request.
 *
 * Server components have no such scope and use `requireUser` instead.
 */
export function requireUserId(): string {
  const userId = currentUserId();
  if (!userId) throw new AppError("UNAUTHORIZED", "No session on a route that requires one");
  return userId;
}

/**
 * For server components. Sends the reader to /login rather than throwing.
 *
 * This used to throw, on the reasoning that the proxy had already redirected
 * anonymous page requests and so a page reaching here meant the two disagreed.
 * They can disagree legitimately, and this is how: the proxy verifies the
 * cookie's signature at the Edge and deliberately reads no database, so a
 * session naming an account that no longer exists passes it and arrives here
 * with nothing to load. Restore a backup, recreate the database, remove a
 * member — or just hold a cookie from a different instance on the same host,
 * since cookies are scoped to a host and ignore the port — and every page
 * answered 500, twice, with a reload sending the same cookie again. There was
 * no way out of it from inside the browser.
 *
 * A stale session is a signed-out reader, so it gets the sign-in page. The
 * cookie is not cleared here — a render may not set one — but nothing needs it
 * to be: /login is public, renders fine with the dead cookie still attached,
 * and signing in overwrites it.
 */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * The same check for route handlers, which answer a `fetch` rather than a
 * person: a 307 to an HTML sign-in page is not something the caller can use,
 * so this keeps the error and the 401 that comes with it.
 */
export async function requireApiUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AppError("UNAUTHORIZED", "No session on a route that requires one");
  return user;
}

/**
 * `passwordHash` is deliberately a string no hash format can parse, so
 * verifyPassword returns false for every input: this account exists to be
 * signed in as by the proxy on loopback, never by presenting a password. It is
 * created here rather than in a migration so it never reaches a production
 * database.
 */
async function createDeveloperAccount(): Promise<User> {
  await db
    .insert(schema.users)
    .values({
      id: DEV_USER_ID,
      email: "dev@localhost",
      displayName: "開発",
      passwordHash: NO_PASSWORD_LOGIN,
      role: "owner",
    })
    .onConflictDoNothing();

  const created = await db.query.users.findFirst({ where: eq(schema.users.id, DEV_USER_ID) });
  if (!created) throw new AppError("INTERNAL", "Development account could not be created");

  // The same adoption registration performs, for the same reason: work that
  // predates accounts belongs to whoever turns out to be using the machine.
  // Without this a developer's own services vanish from their own dashboard
  // the moment queries start filtering by owner.
  await adoptPreAccountRows(db, created.id);
  return created;
}
