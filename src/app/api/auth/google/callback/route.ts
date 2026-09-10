import { NextResponse, type NextRequest } from "next/server";

import { exchangeGoogleCode, googleSignInAvailable } from "@/core/auth/google";
import { signInWithGoogle } from "@/core/auth/users";
import { toAppError } from "@/core/errors";
import { cookieOptions } from "@/proxy";
import { secretFor } from "@/server/auth/current-user";
import { log } from "@/server/log";
import { issueSession, SESSION_COOKIE } from "@/server/session";

import { GOOGLE_STATE_COOKIE, redirectUriFor } from "../route";

export const runtime = "nodejs";

/** Only same-site paths, matching /login's own rule for the same reason: a crafted destination must not bounce someone off Grape right after they authenticate. */
function safeDestination(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function toLogin(origin: string, message: string): NextResponse {
  const response = NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);
  response.cookies.delete(GOOGLE_STATE_COOKIE);
  return response;
}

/**
 * Google lands here after the person picks an account (or cancels).
 *
 * The state cookie is read and deleted in the same response either way — a
 * comparison that succeeds is one-time-use, and one that fails should not
 * leave a stale cookie for a retried attempt to trip over again.
 */
export async function GET(request: NextRequest) {
  const proto =
    request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  const origin = `${proto}://${request.headers.get("host")}`;

  if (!googleSignInAvailable()) return toLogin(origin, "Googleログインは設定されていません。");

  const secret = secretFor(request.headers.get("host"));
  if (!secret) {
    return toLogin(origin, "セッション鍵が設定されていません。.env に GRAPE_SESSION_SECRET を設定してください。");
  }

  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const returnedState = params.get("state");

  let saved: { state?: unknown; next?: unknown; invite?: unknown } = {};
  try {
    saved = JSON.parse(request.cookies.get(GOOGLE_STATE_COOKIE)?.value ?? "{}");
  } catch {
    // Falls through to the state mismatch below, which is the right outcome
    // for a cookie that is present but unparseable.
  }

  // Absent code covers both an explicit `error=access_denied` (cancelled at
  // Google's consent screen) and a malformed callback; neither has anything
  // more specific to say to the person than "try again".
  if (!code || !returnedState || returnedState !== saved.state) {
    if (params.get("error") !== "access_denied") {
      log.warn("auth.google_failed", { reason: !code ? "no_code" : "state_mismatch" });
    }
    return toLogin(origin, "Googleでのログインをやり直してください。");
  }

  try {
    const identity = await exchangeGoogleCode(code, redirectUriFor(request));
    const invite = typeof saved.invite === "string" && saved.invite ? saved.invite : undefined;
    const user = await signInWithGoogle(identity, invite);

    const response = NextResponse.redirect(`${origin}${safeDestination(saved.next)}`);
    response.cookies.set(SESSION_COOKIE, await issueSession(secret, user.id), cookieOptions(request));
    response.cookies.delete(GOOGLE_STATE_COOKIE);
    return response;
  } catch (error) {
    const appError = toAppError(error);
    log.warn("auth.google_failed", { code: appError.code });
    return toLogin(origin, appError.hint ?? "Googleでのログインに失敗しました。");
  }
}
