import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether an Authorization header carries the cron secret as a bearer token.
 *
 * Compared as SHA-256 digests with timingSafeEqual: equal-length inputs are
 * what timingSafeEqual needs, and hashing first means neither the length nor
 * the content of the secret leaks through how long a wrong guess takes.
 */
export function cronAuthorized(header: string | null, secret: string): boolean {
  const presented = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!presented) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(secret));
}
