/**
 * A token bucket in memory.
 *
 * Deliberately not Redis. Grape is one process on one machine for one person;
 * a shared store would be answering a question this deployment does not ask.
 * What it does need to answer: the product id sits in a public <script> tag on
 * the customer's own site, so anyone can read it and post events, and the
 * funnel it would poison is what every diagnosis, task and outcome is built
 * from.
 */

export interface Bucket {
  capacity: number;
  refillPerSec: number;
}

export type Decision = { ok: true } | { ok: false; retryAfterSec: number };

interface State {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, State>();

/** Swept only when the map grows, so ordinary traffic pays nothing for it. */
const SWEEP_THRESHOLD = 5_000;
const IDLE_MS = 10 * 60 * 1000;

export function takeToken(key: string, bucket: Bucket, now: number = Date.now()): Decision {
  const state = buckets.get(key) ?? { tokens: bucket.capacity, updatedAt: now };

  const elapsedSec = Math.max(0, now - state.updatedAt) / 1000;
  const tokens = Math.min(bucket.capacity, state.tokens + elapsedSec * bucket.refillPerSec);

  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return { ok: false, retryAfterSec: Math.ceil((1 - tokens) / bucket.refillPerSec) };
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  if (buckets.size > SWEEP_THRESHOLD) sweep(now);
  return { ok: true };
}

function sweep(now: number): void {
  for (const [key, state] of buckets) {
    if (now - state.updatedAt > IDLE_MS) buckets.delete(key);
  }
}

/** Tests only — the map is process-wide by design. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Spoofable, and that is accepted: the aim is to make flooding cost something,
 * not to make it impossible. Paired with a per-product bucket that no amount
 * of address rotation gets around.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (
    request.headers.get("cf-connecting-ip") ??
    forwarded?.split(",")[0]?.trim() ??
    "unknown"
  );
}
