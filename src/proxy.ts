import { NextResponse, type NextRequest } from "next/server";

import {
  DEV_USER_ID,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  isLoopbackHost,
  issueSession,
  readSession,
  sessionSecret,
} from "@/server/session";

/**
 * The dashboard is only safe on localhost. The moment it is deployed — and it
 * has to be, because the tracking snippet needs a public origin — everything
 * here becomes reachable from the internet: the Product Context, the funnel,
 * and the button that spends money posting to X.
 *
 * So the default is neither open nor closed, but scoped to the host: with
 * nothing configured, a non-production build reached over loopback signs
 * itself in as the development account, and anything else is refused. A fresh
 * checkout runs with zero configuration, and a deployment is shut until
 * GRAPE_SESSION_SECRET exists. The threat is the public origin, not the
 * loopback interface.
 *
 * Reads process.env directly rather than importing @/env: this runs on the
 * Edge runtime, where enumerating process.env is not reliable and pulling in
 * zod would be dead weight.
 */

/**
 * Reachable without a session: the snippet's ingest and script, the login and
 * registration flow itself, and the health check — which stays public so an
 * uptime monitor needs no credentials, and redacts its own payload for callers
 * that have none.
 */
const PUBLIC_PREFIXES = [
  "/api/collect",
  "/api/auth/",
  "/api/health",
  "/login",
  "/register",
  "/g.js",
  "/_next/",
  "/favicon.ico",
];

export const REQUEST_ID_HEADER = "x-request-id";

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function withRequestId(request: NextRequest): NextResponse {
  // Minted here and forwarded so the Node-side route wrapper can open its
  // AsyncLocalStorage scope with an id that spans the whole request.
  const headers = new Headers(request.headers);
  if (!headers.has(REQUEST_ID_HEADER)) headers.set(REQUEST_ID_HEADER, crypto.randomUUID());
  return NextResponse.next({ request: { headers } });
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return withRequestId(request);

  const configured = process.env.GRAPE_SESSION_SECRET;
  // Only when nothing is configured: a developer who has set a secret has
  // asked for real accounts, and signing them in as someone else would be a
  // surprising way to honour that.
  const devMode =
    !configured && process.env.NODE_ENV !== "production" && isLoopbackHost(request.headers.get("host"));
  const secret = sessionSecret(configured, devMode);

  if (!secret) {
    return NextResponse.json(
      {
        error:
          "このGrapeは公開URLからアクセスされていますが、セッション鍵が設定されていません。.env に GRAPE_SESSION_SECRET を設定してから、もう一度開いてください。",
        code: "UNAUTHORIZED",
      },
      { status: 503 },
    );
  }

  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value, secret);

  if (!session.valid) {
    if (devMode) return await signInAsDeveloper(request, secret);

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

  const response = withRequestId(request);
  if (session.shouldRenew) {
    response.cookies.set(SESSION_COOKIE, await issueSession(secret, session.userId), cookieOptions(request));
  }
  return response;
}

/**
 * Issues an ordinary signed token rather than waving the request through or
 * injecting a header naming the user.
 *
 * A header would be a second way to become someone — one a client could send
 * directly to a Node route the day this matcher stops covering some path. The
 * signed cookie keeps exactly one path to an identity, so the Edge and the
 * database-side code are answering the same question the same way.
 *
 * The row this names is created on first use by requireUser(); seeding it in a
 * migration would put a development account in production databases too.
 */
async function signInAsDeveloper(request: NextRequest, secret: string): Promise<NextResponse> {
  const response = withRequestId(request);
  response.cookies.set(SESSION_COOKIE, await issueSession(secret, DEV_USER_ID), cookieOptions(request));
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
