import { cookies, headers } from "next/headers";
import { cache } from "react";
import { eq } from "drizzle-orm";

import { adoptPreAccountRows } from "@/core/auth/users";
import { AppError } from "@/core/errors";
import { db, schema } from "@/db/client";
import { env } from "@/env";
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

function secretFor(host: string | null | undefined): string | null {
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

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  // The proxy has already redirected anonymous page requests to /login, so
  // reaching here without a session means the two disagree — an error, not a
  // sign-in prompt.
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
      passwordHash: "no-password-login",
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
