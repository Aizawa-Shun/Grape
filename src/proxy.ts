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
 * that have none. /api/cron/ is authenticated too, just not by a session: a
 * scheduler has no account to sign in as, so it presents GRAPE_CRON_SECRET
 * instead and the route checks it (see api/cron/tick/route.ts).
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
 * Next serves the app/ icon conventions from their own top-level routes, and
 * every one of them was behind the session — so a signed-out browser followed
 * a redirect to /login, got HTML where it expected an image, and showed the
 * blank page icon. On the login page itself, next to the mark it does render.
 *
 * Matched exactly rather than by prefix: these are a fixed, generated set
 * (including the numbered variants Next allows), and "/icon" as a prefix would
 * quietly open any future route whose name began with it.
 */
const ICON_ROUTE = /^\/(icon|apple-icon)\d*\.(png|jpe?g|svg|ico)$/;

export const REQUEST_ID_HEADER = "x-request-id";

function isPublic(pathname: string): boolean {
  if (ICON_ROUTE.test(pathname)) return true;
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

  if (!secret) return unconfigured(request);

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

const UNCONFIGURED_MESSAGE =
  "このGrapeは公開URLからアクセスされていますが、セッション鍵が設定されていません。.env に GRAPE_SESSION_SECRET を設定してから、もう一度開いてください。";

/**
 * The one refusal an operator has to be able to read.
 *
 * A browser navigating to a page cannot show a JSON body: Next's router sees a
 * payload it cannot parse and falls back to its own "This page couldn't load",
 * which names nothing and offers only Reload — and reloading returns the same
 * 503 forever, because every non-public path is refused. So a document request
 * gets the instruction as HTML, and only an API caller gets JSON.
 */
function unconfigured(request: NextRequest): NextResponse {
  const wantsHtml =
    !request.nextUrl.pathname.startsWith("/api/") &&
    (request.headers.get("accept") ?? "").includes("text/html");

  if (!wantsHtml) {
    return NextResponse.json({ error: UNCONFIGURED_MESSAGE, code: "UNAUTHORIZED" }, { status: 503 });
  }

  return new NextResponse(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Grape — 設定が必要です</title>` +
      `<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:2rem;` +
      `font:16px/1.7 system-ui,sans-serif;color:#1c1917;background:#faf9f7}` +
      `main{max-width:34rem}h1{font-size:1.25rem;margin:0 0 .75rem}` +
      `code{background:#efece8;padding:.15em .4em;border-radius:.25rem;font-size:.9em}` +
      `pre{background:#1c1917;color:#fafaf9;padding:.85rem 1rem;border-radius:.5rem;overflow-x:auto}</style>` +
      `</head><body><main><h1>設定が必要です</h1><p>${UNCONFIGURED_MESSAGE}</p>` +
      `<p>鍵はこれで作れます:</p>` +
      `<pre>node -e "console.log(crypto.randomUUID())"</pre>` +
      `<p><code>.env</code> に <code>GRAPE_SESSION_SECRET=…</code> として書き、サーバを再起動してください。</p>` +
      `</main></body></html>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
  );
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
