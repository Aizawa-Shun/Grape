import { NextResponse, type NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  issueSession,
  readSession,
  sessionSecret,
} from "@/server/session";

/**
 * The dashboard is only safe on localhost. The moment `pnpm tunnel` is used —
 * and it has to be, because the tracking snippet needs a public origin —
 * everything here becomes reachable from the internet: the Product Context,
 * the funnel, and the button that spends money posting to X.
 *
 * So the default is neither open nor closed, but scoped to the host: with no
 * password set, requests to localhost pass and anything else is refused. A
 * fresh checkout runs with zero configuration, and the tunnel is shut until a
 * password exists. The threat is the tunnel, not the loopback interface.
 *
 * Reads process.env directly rather than importing @/env: this runs on the
 * Edge runtime, where enumerating process.env is not reliable and pulling in
 * zod would be dead weight.
 */

/**
 * Reachable without a session: the snippet's ingest and script, the login flow
 * itself, and the health check — which stays public so an uptime monitor needs
 * no credentials, and redacts its own payload for callers that have none.
 */
const PUBLIC_PREFIXES = [
  "/api/collect",
  "/api/auth/",
  "/api/health",
  "/login",
  "/g.js",
  "/_next/",
  "/favicon.ico",
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export const REQUEST_ID_HEADER = "x-request-id";

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function isLocalHost(request: NextRequest): boolean {
  const host = request.headers.get("host") ?? "";
  return LOCAL_HOSTS.has(host.replace(/:\d+$/, ""));
}

function withRequestId(request: NextRequest): NextResponse {
  // Minted here and forwarded so the Node-side route wrapper can open its
  // AsyncLocalStorage scope with an id that spans the whole request.
  const headers = new Headers(request.headers);
  if (!headers.has(REQUEST_ID_HEADER)) headers.set(REQUEST_ID_HEADER, crypto.randomUUID());
  return NextResponse.next({ request: { headers } });
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return withRequestId(request);

  const password = process.env.GRAPE_ADMIN_PASSWORD;
  const secret = await sessionSecret(process.env.GRAPE_SESSION_SECRET, password);

  if (!secret) {
    if (isLocalHost(request)) return withRequestId(request);
    return NextResponse.json(
      {
        error:
          "このGrapeは公開URLからアクセスされていますが、パスワードが設定されていません。.env に GRAPE_ADMIN_PASSWORD を設定してから、もう一度開いてください。",
        code: "UNAUTHORIZED",
      },
      { status: 503 },
    );
  }

  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value, secret);

  if (!session.valid) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "ログインが必要です。パスワードを入力してください。", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  const response = withRequestId(request);
  if (session.shouldRenew) {
    response.cookies.set(SESSION_COOKIE, await issueSession(secret), cookieOptions(request));
  }
  return response;
}

export function cookieOptions(request: NextRequest | Request) {
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

export const config = {
  // Everything except Next's own assets; the finer-grained public list above
  // does the real work.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
