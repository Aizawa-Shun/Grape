/**
 * Sessions are Firebase Authentication session cookies.
 *
 * The browser signs in with the Firebase client SDK and hands the resulting
 * ID token to POST /api/auth/session, which — once the account has been let
 * into Grape (core/auth/users.ts's enrollAccount) — exchanges it for a
 * session cookie. Every server render and API route verifies that cookie with
 * the Admin SDK (server/auth/current-user.ts).
 *
 * `__session` is not a style choice: it is the one cookie name Firebase's CDN
 * forwards to the server. Any other name is stripped before the request
 * arrives, and every signed-in page would look signed out.
 *
 * This module is imported by the Edge proxy too, so it holds only names and
 * numbers — nothing that pulls in the Admin SDK.
 */

export const SESSION_COOKIE = "__session";

/** Firebase caps session cookies at two weeks. */
export const SESSION_TTL_SEC = 14 * 24 * 60 * 60;

export function cookieOptions(request: Request) {
  const proto =
    request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SEC,
    secure: proto === "https",
  };
}
