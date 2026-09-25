import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

import { env } from "@/env";

/**
 * Encrypts values that have to come back out whole — a user's own Anthropic
 * or OpenAI-compatible API key, read every time Grape calls a model on their
 * behalf. Not for anything hashing already covers (invite codes): those never
 * need to be recovered, so a one-way hash is strictly better wherever it
 * applies. This is for the one case where it does not.
 *
 * Keyed off GRAPE_ENCRYPTION_KEY, which lives in Secret Manager on App
 * Hosting (apphosting.yaml) and never in Firestore. That separation is the
 * point: someone who obtains a Firestore export — a leaked backup, a
 * misconfigured rule — gets ciphertext, not working API keys.
 *
 * Outside production a fixed development key applies when none is set, so
 * the emulators work with no setup; in production a missing key is an error
 * at the first encryption, not a silent fallback.
 */
const DEV_KEY = "grape-development-only-never-in-production";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function appSecret(): string {
  if (env.GRAPE_ENCRYPTION_KEY) return env.GRAPE_ENCRYPTION_KEY;
  if (process.env.NODE_ENV === "production") {
    throw new Error("GRAPE_ENCRYPTION_KEY is not set; stored API keys cannot be encrypted or read.");
  }
  return DEV_KEY;
}

/**
 * scrypt exists in this call to turn an arbitrary-length secret into exactly
 * 32 bytes, not to stretch a low-entropy password — GRAPE_ENCRYPTION_KEY
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
