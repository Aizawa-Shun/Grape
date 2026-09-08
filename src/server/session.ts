/**
 * A signed session cookie, using Web Crypto only.
 *
 * Web Crypto rather than node:crypto because this has to run in proxy.ts,
 * which Next executes on the Edge runtime where node builtins are unavailable.
 * The same code works unchanged under Node, so the login route and the
 * proxy share one implementation.
 *
 * There is no user identity in the token because there is no second user. The
 * payload is just an expiry, signed; the whole question being answered is
 * "did this browser present the password at some point recently".
 */

const encoder = new TextEncoder();

export const SESSION_COOKIE = "grape_session";
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60;
/** Re-issued when less than this remains, so an active session never expires underfoot. */
export const SESSION_RENEW_BEFORE_SEC = 7 * 24 * 60 * 60;

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

export async function issueSession(secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const expSec = nowSec + SESSION_TTL_SEC;
  const signature = await crypto.subtle.sign("HMAC", await keyFor(secret), encoder.encode(String(expSec)));
  return `${expSec}.${base64url(signature)}`;
}

export interface SessionState {
  valid: boolean;
  /** True when the token is still good but close enough to expiry to reissue. */
  shouldRenew: boolean;
}

export async function readSession(
  token: string | undefined,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<SessionState> {
  if (!token) return { valid: false, shouldRenew: false };

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return { valid: false, shouldRenew: false };

  const expPart = token.slice(0, separator);
  const expSec = Number(expPart);
  if (!Number.isSafeInteger(expSec)) return { valid: false, shouldRenew: false };

  let signature: Uint8Array;
  try {
    signature = fromBase64url(token.slice(separator + 1));
  } catch {
    return { valid: false, shouldRenew: false };
  }

  // subtle.verify is constant-time, which is why the comparison is not done by
  // hand.
  const ok = await crypto.subtle.verify(
    "HMAC",
    await keyFor(secret),
    signature as BufferSource,
    encoder.encode(expPart),
  );
  if (!ok || expSec <= nowSec) return { valid: false, shouldRenew: false };

  return { valid: true, shouldRenew: expSec - nowSec < SESSION_RENEW_BEFORE_SEC };
}

/**
 * Deriving from the password when no explicit secret is set means one variable
 * is enough to get started, and changing the password invalidates every
 * existing session for free.
 */
export async function sessionSecret(
  explicitSecret: string | undefined,
  password: string | undefined,
): Promise<string | null> {
  if (explicitSecret) return explicitSecret;
  if (!password) return null;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`grape:${password}`));
  return base64url(digest);
}
