import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/server/session";

/**
 * The first gate every request passes, on the Edge.
 *
 * It can only look for the session cookie, not verify it: verifying a
 * Firebase session cookie takes the Admin SDK, which does not run on the
 * Edge. So this is the part that sends a signed-out browser to /login and a
 * signed-out `fetch` a 401, and the real check — signature, expiry,
 * revocation — happens in Node on every page and route
 * (server/auth/current-user.ts). A forged or stale cookie gets past this and
 * is stopped there.
 *
 * It also mints the request id the Node-side route wrapper logs under.
 *
 * Reads no environment and imports nothing heavy: whatever this module pulls
 * in is bundled for the Edge runtime.
 */

/**
 * Reachable without a session: the snippet's ingest and script, the sign-in
 * flow itself, and the health check — public so an uptime monitor needs no
 * credentials, and it redacts its own payload for callers that have none.
 * /api/cron/ is authenticated too, just not by a session: a scheduler has no
 * account to sign in as, so it presents GRAPE_CRON_SECRET instead and the
 * route checks it (see api/cron/tick/route.ts).
 */
const PUBLIC_PREFIXES = [
  "/api/collect",
  "/api/cron/",
  "/api/auth/",
  "/api/health",
  "/login",
  "/register",
  "/g.js",
  "/_next/",
  "/favicon.ico",
];

/**
 * Next serves the app/ icon conventions from their own top-level routes.
 * Matched exactly rather than by prefix: "/icon" as a prefix would quietly
 * open any future route whose name began with it.
 */
const ICON_ROUTE = /^\/(icon|apple-icon)\d*\.(png|jpe?g|svg|ico)$/;

export const REQUEST_ID_HEADER = "x-request-id";

function isPublic(pathname: string): boolean {
  if (ICON_ROUTE.test(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function withRequestId(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  if (!headers.has(REQUEST_ID_HEADER)) headers.set(REQUEST_ID_HEADER, crypto.randomUUID());
  return NextResponse.next({ request: { headers } });
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return withRequestId(request);

  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "ログインが必要です。もう一度ログインしてください。", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  return withRequestId(request);
}

export const config = {
  // Everything except Next's own assets; the finer-grained public list above
  // does the real work.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
