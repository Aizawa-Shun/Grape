import { NextResponse } from "next/server";
import { z } from "zod";

import { registerFirstUser, redeemInvite } from "@/core/auth/users";
import { toAppError } from "@/core/errors";
import { env } from "@/env";
import { cookieOptions } from "@/proxy";
import { describeForUser, statusOf } from "@/server/http/errors";
import { log } from "@/server/log";
import { clientAddress, takeToken } from "@/server/rate-limit";
import { SESSION_COOKIE, isLoopbackHost, issueSession, sessionSecret } from "@/server/session";

export const runtime = "nodejs";

const RegisterInputSchema = z.object({
  email: z.string().min(1),
  displayName: z.string().min(1),
  password: z.string().min(1),
  /** Absent for the first account, which is the one that closes registration. */
  code: z.string().optional(),
});

/**
 * Tighter than login's bucket, because what is guessable here is an invite
 * code rather than a password — and a code that works creates an account
 * rather than opening one.
 */
const ATTEMPTS = { capacity: 5, refillPerSec: 1 / 300 };

export async function POST(request: Request) {
  const attempt = takeToken(`register:${clientAddress(request)}`, ATTEMPTS);
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

  const parsed = RegisterInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "入力が足りません。すべての欄を埋めてください。", code: "INVALID_INPUT" },
      { status: 400 },
    );
  }

  const { code, ...account } = parsed.data;

  try {
    const user = code ? await redeemInvite(code, account) : await registerFirstUser(account);

    const response = NextResponse.json({ ok: true }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, await issueSession(secret, user.id), cookieOptions(request));
    return response;
  } catch (error) {
    const shown = toAppError(error);
    if (shown.code === "UNAUTHORIZED") log.warn("auth.invite_rejected", { ip: clientAddress(request) });

    // The hint alone, when there is one. Every failure this route can produce
    // is a specific situation with a sentence written for it, and the catalog's
    // general line for the same code describes something else — CONFLICT's is
    // "already done, reload the page", which is not what a closed registration
    // means. The catalog still covers anything unforeseen.
    return NextResponse.json(
      { error: shown.hint ?? describeForUser(shown), code: shown.code },
      { status: statusOf(shown) },
    );
  }
}
