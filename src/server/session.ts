/**
 * A signed session cookie, using Web Crypto only.
 *
 * Web Crypto rather than node:crypto because this has to run in proxy.ts,
 * which Next executes on the Edge runtime where node builtins are unavailable.
 * The same code works unchanged under Node, so the login route and the proxy
 * share one implementation.
 *
 * The token names its subject. That is the whole difference from the
 * single-password design that came before: the question is no longer "did
 * this browser present the password recently" but "which account is this".
 * The id is inside the signature, so it cannot be edited without invalidating
 * the token, and the Edge can answer the question without a database.
 */

const encoder = new TextEncoder();

export const SESSION_COOKIE = "grape_session";
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60;
/** Re-issued when less than this remains, so an active session never expires underfoot. */
export const SESSION_RENEW_BEFORE_SEC = 7 * 24 * 60 * 60;

/**
 * Version prefix so the tokens issued by the previous design — `<exp>.<sig>`,
 * with no subject — fail on structure rather than being reinterpreted. Anyone
 * holding one is sent to log in, which is the correct outcome: their session
 * predates the account their id would have to name.
 */
const VERSION = "v2";

/**
 * The account the app runs as on a developer's machine when nothing is
 * configured. proxy.ts issues a normal signed token for it; requireUser()
 * creates the row the first time it is needed. Never reachable in production
 * or off the loopback interface — see sessionSecret.
 */
export const DEV_USER_ID = "dev";

/**
 * Signs the developer cookie when no secret is configured. A literal rather
 * than a derived value because it must match between the Edge proxy and the
 * Node routes, and Next inlines env references into the Edge bundle at build
 * time — a derivation would be one more thing to get wrong for no benefit.
 * It is not a secret and does not need to be: it only ever applies to
 * localhost in a non-production build, and the threat was never the loopback
 * interface.
 */
export const DEV_SECRET = "grape-development-only-never-in-production";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Shared so the Edge proxy and the Node routes cannot disagree about what
 * counts as local — a split between them would mean one of the two applying
 * the developer fallback while the other refuses it.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  return LOOPBACK_HOSTS.has(withoutPort(host ?? ""));
}

/**
 * Stripping a trailing `:<digits>` is wrong for a bare IPv6 address, where the
 * last colon group is part of the address: `::1` would come back as `:` and
 * stop matching anything. A literal in a Host header is normally bracketed, so
 * brackets are the signal — and a colon-heavy host without them is an address,
 * not an address and a port.
 */
function withoutPort(host: string): string {
  const bare = !host.startsWith("[") && (host.match(/:/g)?.length ?? 0) > 1;
  return bare ? host : host.replace(/:\d+$/, "");
}

function base64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function keyFor(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function issueSession(
  secret: string,
  userId: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload = `${VERSION}.${userId}.${nowSec + SESSION_TTL_SEC}`;
  const signature = await crypto.subtle.sign("HMAC", await keyFor(secret), encoder.encode(payload));
  return `${payload}.${base64url(signature)}`;
}

export type SessionState =
  | { valid: false }
  /** `shouldRenew` is true when the token is still good but close enough to expiry to reissue. */
  | { valid: true; userId: string; shouldRenew: boolean };

const INVALID: SessionState = { valid: false };

export async function readSession(
  token: string | undefined,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<SessionState> {
  if (!token) return INVALID;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return INVALID;

  const payload = token.slice(0, separator);
  const [version, userId, expPart, ...rest] = payload.split(".");
  if (version !== VERSION || !userId || rest.length > 0) return INVALID;

  const expSec = Number(expPart);
  if (!Number.isSafeInteger(expSec)) return INVALID;

  let signature: Uint8Array;
  try {
    signature = fromBase64url(token.slice(separator + 1));
  } catch {
    return INVALID;
  }

  // subtle.verify is constant-time, which is why the comparison is not done by
  // hand. Verifying before checking expiry keeps both branches on the same
  // path for a token that is merely old.
  const ok = await crypto.subtle.verify(
    "HMAC",
    await keyFor(secret),
    signature as BufferSource,
    encoder.encode(payload),
  );
  if (!ok || expSec <= nowSec) return INVALID;

  return { valid: true, userId, shouldRenew: expSec - nowSec < SESSION_RENEW_BEFORE_SEC };
}

/**
 * What signs the cookie.
 *
 * The old rule derived a key from GRAPE_ADMIN_PASSWORD; per-account passwords
 * are hashed, so there is nothing left to derive from. An explicitly
 * configured secret is now the only thing that works anywhere real.
 *
 * `allowDevFallback` is the caller's answer to "is this a non-production build
 * being reached over loopback". When it is, and only when nothing is
 * configured, the developer key applies and a fresh checkout runs with no
 * setup at all. Anywhere else, no secret means no sessions — which the proxy
 * turns into a 503 telling the operator what to set.
 */
export function sessionSecret(
  explicitSecret: string | undefined,
  allowDevFallback: boolean,
): string | null {
  if (explicitSecret) return explicitSecret;
  return allowDevFallback ? DEV_SECRET : null;
}
