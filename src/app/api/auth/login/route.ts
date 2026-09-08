import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/env";
import { log } from "@/server/log";
import { clientAddress, takeToken } from "@/server/rate-limit";
import { SESSION_COOKIE, SESSION_TTL_SEC, issueSession, sessionSecret } from "@/server/session";

export const runtime = "nodejs";

const LoginInputSchema = z.object({ password: z.string().min(1) });

/** Slow enough that guessing a password over the network is not worth starting. */
const ATTEMPTS = { capacity: 5, refillPerSec: 1 / 60 };

export async function POST(request: Request) {
  const attempt = takeToken(`login:${clientAddress(request)}`, ATTEMPTS);
  if (!attempt.ok) {
    return NextResponse.json(
      { error: "試行回数が多すぎます。しばらく待ってから、もう一度お試しください。", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSec) } },
    );
  }

  const parsed = LoginInputSchema.safeParse(await request.json().catch(() => null));
  const secret = await sessionSecret(env.GRAPE_SESSION_SECRET, env.GRAPE_ADMIN_PASSWORD);

  if (!secret || !env.GRAPE_ADMIN_PASSWORD) {
    return NextResponse.json(
      { error: "パスワードが設定されていません。.env に GRAPE_ADMIN_PASSWORD を設定してください。", code: "UNAUTHORIZED" },
      { status: 503 },
    );
  }

  if (!parsed.success || parsed.data.password !== env.GRAPE_ADMIN_PASSWORD) {
    log.warn("auth.failed", { ip: clientAddress(request) });
    return NextResponse.json(
      { error: "パスワードが違います。", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await issueSession(secret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
    secure: (request.headers.get("x-forwarded-proto") ?? "http") === "https",
  });
  return response;
}
