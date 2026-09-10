import { NextResponse, type NextRequest } from "next/server";

import { googleAuthorizationUrl, googleSignInAvailable } from "@/core/auth/google";
import { cookieOptions } from "@/proxy";

export const runtime = "nodejs";

/** Where the callback exchanges Google's code — must exactly match a URI registered on the OAuth client. */
export function redirectUriFor(request: Request): string {
  const proto =
    request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${proto}://${request.headers.get("host")}/api/auth/google/callback`;
}

export const GOOGLE_STATE_COOKIE = "grape_google_state";

/**
 * Starts the redirect to Google. GET rather than POST: this is a plain link a
 * browser follows ("Googleでログイン"), not a form submission, and a
 * top-level navigation is what the OAuth redirect chain requires anyway —
 * there is no client-side fetch that could stand in for it.
 *
 * `next` and `invite` travel inside the state cookie rather than as query
 * parameters on the callback URL, because the callback URL is fixed by what
 * is registered with Google — it cannot carry anything this request did not
 * put in the state it gets back verbatim.
 */
export async function GET(request: NextRequest) {
  if (!googleSignInAvailable()) {
    return NextResponse.json(
      { error: "Googleログインは設定されていません。", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const next = request.nextUrl.searchParams.get("next");
  const invite = request.nextUrl.searchParams.get("invite");
  const state = crypto.randomUUID();

  const response = NextResponse.redirect(googleAuthorizationUrl(redirectUriFor(request), state));
  response.cookies.set(
    GOOGLE_STATE_COOKIE,
    JSON.stringify({ state, next, invite }),
    // Five minutes: long enough for someone to actually pick a Google
    // account, short enough that an abandoned attempt does not sit around.
    // Scoped to the one path that reads it, so it never rides along on
    // ordinary requests.
    { ...cookieOptions(request), maxAge: 300, path: "/api/auth/google" },
  );
  return response;
}
