import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { cookieOptions } from "@/proxy";
import { db, schema } from "@/db/client";
import { env } from "@/env";
import { verifyDummy, verifyPassword } from "@/server/auth/password";
import { log } from "@/server/log";
import { clientAddress, takeToken } from "@/server/rate-limit";
import { SESSION_COOKIE, isLoopbackHost, issueSession, sessionSecret } from "@/server/session";

export const runtime = "nodejs";

const LoginInputSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Kept per-address rather than per-address-and-e-mail. Adding the account to
 * the key would multiply an attacker's budget by the number of accounts they
 * care to name, which is the opposite of what a limit is for: one address gets
 * this many attempts at the whole instance.
 */
const ATTEMPTS = { capacity: 5, refillPerSec: 1 / 60 };

export async function POST(request: Request) {
  const attempt = takeToken(`login:${clientAddress(request)}`, ATTEMPTS);
  if (!attempt.ok) {
    return NextResponse.json(
      { error: "試行回数が多すぎます。しばらく待ってから、もう一度お試しください。", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSec) } },
    );
  }

  const devMode =
    !env.GRAPE_SESSION_SECRET &&
    process.env.NODE_ENV !== "production" &&
    isLoopbackHost(request.headers.get("host"));
  const secret = sessionSecret(env.GRAPE_SESSION_SECRET, devMode);

  if (!secret) {
    return NextResponse.json(
      {
        error: "セッション鍵が設定されていません。.env に GRAPE_SESSION_SECRET を設定してください。",
        code: "UNAUTHORIZED",
      },
      { status: 503 },
    );
  }

  const parsed = LoginInputSchema.safeParse(await request.json().catch(() => null));
  const email = parsed.success ? parsed.data.email.trim().toLowerCase() : "";
  const password = parsed.success ? parsed.data.password : "";

  const user = email
    ? await db.query.users.findFirst({ where: eq(schema.users.email, email) })
    : undefined;

  // An unknown address still pays for a hash, so how long this takes does not
  // answer "does that account exist here".
  const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyDummy(password);

  if (!ok || !user) {
    log.warn("auth.failed", { ip: clientAddress(request) });
    return NextResponse.json(
      { error: "メールアドレスかパスワードが違います。", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  await db
    .update(schema.users)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.users.id, user.id));

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await issueSession(secret, user.id), cookieOptions(request));
  return response;
}
