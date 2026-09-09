import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with scrypt from node:crypto.
 *
 * No dependency is added for this: the login and registration routes declare
 * `runtime = "nodejs"`, so the standard library is available, and a hashing
 * library is exactly the kind of thing that should not arrive as an unaudited
 * transitive dependency. (proxy.ts runs on the Edge and never hashes — it only
 * verifies a signature, which is Web Crypto.)
 *
 * The cost parameters are stored inside the hash rather than fixed in code, so
 * raising them later re-hashes on next login instead of locking everyone out.
 */

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/**
 * N=16384 costs ~16 MB (128·N·r), half of Node's 32 MB scrypt ceiling, so it
 * needs no maxmem override. It takes tens of milliseconds — the login route's
 * existing five-attempts-per-hour bucket, not raw hash cost, is what makes
 * guessing over the network pointless.
 */
const PARAMS: ScryptParams = { N: 16384, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // NFKC so a password typed with a full-width or composed character
    // verifies against the same password typed the other way.
    scrypt(password.normalize("NFKC"), salt, KEY_BYTES, params, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

function parse(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;

  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every((n) => Number.isSafeInteger(n) && n > 0)) return null;

  try {
    const salt = Buffer.from(parts[4], "base64");
    const key = Buffer.from(parts[5], "base64");
    // The key length is fixed here, not read from the row. scrypt ends in a
    // single-iteration PBKDF2, whose output at a shorter length is a prefix of
    // the longer one — so deriving to whatever length the stored value happened
    // to have would let a hash truncated to one byte verify against 1 in 256 of
    // all passwords. Cost parameters may vary between rows; how much of the
    // answer gets compared may not.
    if (salt.length === 0 || key.length !== KEY_BYTES) return null;
    return { params: { N, r, p }, salt, key };
  } catch {
    return null;
  }
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;

  const candidate = await derive(password, parsed.salt, parsed.params);
  // parse() has already guaranteed the lengths match; timingSafeEqual throws
  // rather than returning false when they do not, so this stays as a guard.
  if (candidate.length !== parsed.key.length) return false;
  return timingSafeEqual(candidate, parsed.key);
}

/**
 * A real hash of a random string nobody holds. Verifying against it when the
 * e-mail is unknown makes a wrong address cost the same as a wrong password,
 * so response time does not answer "does this account exist".
 *
 * Hardcoded rather than generated at boot, so the very first unknown-address
 * attempt is already indistinguishable from the rest.
 */
const DUMMY_HASH =
  "scrypt$16384$8$1$H4AaZIuU15b1BbuPJO8wqg==$upfrytrBxSTmrzOpvQZZuStX2roSW+8hZ4/SUD/LfnHvHfCbTLV37K21kvM6U03+N9zelPlhrCb7xjlIG8z5Zg==";

export async function verifyDummy(password: string): Promise<false> {
  await verifyPassword(password, DUMMY_HASH);
  return false;
}
