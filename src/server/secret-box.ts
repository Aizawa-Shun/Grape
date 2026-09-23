import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

import { env } from "@/env";
import { DEV_SECRET } from "@/server/session";

/**
 * Encrypts values that have to come back out whole — a user's own Anthropic
 * or OpenAI-compatible API key, read every time Grape calls a model on their
 * behalf. Not for anything hashing already covers (passwords, invite codes):
 * those never need to be recovered, so a one-way hash is strictly better than
 * this wherever it applies. This is for the one case where it does not.
 *
 * Keyed off GRAPE_SESSION_SECRET rather than a secret of its own: a second
 * required env var earns its keep only if it protects against something the
 * first does not, and it would not here — anyone who can read
 * GRAPE_SESSION_SECRET can already forge a session for any account and reach
 * a plaintext key through the app itself. What this *does* protect against is
 * the threat core/settings/index.ts already names for every other secret: a
 * leaked database file, or a stolen backup, on its own. The DEV_SECRET
 * fallback is exactly as safe as session.ts's own use of it, for the same
 * reason — it only ever applies to a non-production build reached over
 * loopback.
 */
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function appSecret(): string {
  return env.GRAPE_SESSION_SECRET ?? DEV_SECRET;
}

/**
 * scrypt exists in this call to turn an arbitrary-length secret into exactly
 * 32 bytes, not to stretch a low-entropy password — GRAPE_SESSION_SECRET
 * already carries whatever entropy there is, so a fixed salt is fine. The
 * salt string doubles as domain separation from anything else that might one
 * day derive a different key from the same secret.
 */
function deriveKey(secret: string): Buffer {
  return scryptSync(secret, "grape.secret-box.v1", 32);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(appSecret()), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/**
 * Throws on anything that does not look like this module's own output —
 * truncated data, a wrong tag, a key that has changed underneath it — rather
 * than returning garbage a caller might mistake for a working API key.
 */
export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, deriveKey(appSecret()), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
