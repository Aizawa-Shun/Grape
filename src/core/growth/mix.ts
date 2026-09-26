/**
 * Content-mix arithmetic. A model proposes the pillars and roughly how much
 * of each; that the shares are whole numbers adding up to exactly 100 is
 * decided here, so a strategy never shows a mix that does not add up.
 */

/** Largest-remainder rounding: integer parts that sum to exactly `total`. */
export function apportion(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (weights.length === 0) return [];
  if (sum <= 0) return apportion(weights.map(() => 1), total);

  const exact = weights.map((w) => (Math.max(0, w) / sum) * total);
  const floors = exact.map(Math.floor);
  let remaining = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (remaining <= 0) break;
    floors[index] += 1;
    remaining -= 1;
  }
  return floors;
}

/** Shares normalised to integers summing to 100. */
export function normalizeShares<T extends { share: number }>(pillars: T[]): T[] {
  const shares = apportion(
    pillars.map((p) => p.share),
    100,
  );
  return pillars.map((pillar, index) => ({ ...pillar, share: shares[index] }));
}
