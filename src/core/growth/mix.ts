import type { ContentPillar, PlanSlot, PostType } from "@/db/schema";

/**
 * The content mix, as arithmetic.
 *
 * A model proposes the pillars and roughly how much of each; everything that
 * has a right answer after that — shares that actually sum to 100, how seven
 * posts divide between pillars at those shares, which day each lands on — is
 * decided here, so the plan the reader sees always adds up and the learning
 * step (strategist.ts) can re-weight it without asking a model to re-count.
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

/**
 * Seven slots for the week, one per day, allocated by share and interleaved
 * so the same pillar does not run three days in a row. `topics` supplies the
 * slot's subject per pillar, cycling if a pillar gets more slots than ideas.
 */
export function planWeek(
  pillars: ContentPillar[],
  topics: Record<string, string[]>,
  days = 7,
): PlanSlot[] {
  if (pillars.length === 0) return [];
  const counts = apportion(
    pillars.map((p) => p.share),
    days,
  );

  // Round-robin over pillars weighted by remaining count — spreads repeats out.
  const remaining = [...counts];
  const used: Record<string, number> = {};
  const slots: PlanSlot[] = [];
  let last = -1;
  for (let day = 0; day < days; day++) {
    // The pillar with the most slots left, avoiding yesterday's when another
    // is still available; ties go to the earlier (larger-share) pillar.
    let pick = -1;
    for (let i = 0; i < pillars.length; i++) {
      if (remaining[i] <= 0 || i === last) continue;
      if (pick === -1 || remaining[i] > remaining[pick]) pick = i;
    }
    if (pick === -1 && last !== -1 && remaining[last] > 0) pick = last;
    if (pick === -1) break;
    remaining[pick] -= 1;
    last = pick;

    const pillar = pillars[pick];
    const ideas = topics[pillar.name] ?? [];
    const n = used[pillar.name] ?? 0;
    used[pillar.name] = n + 1;
    const postTypes: PostType[] = pillar.postTypes.length > 0 ? pillar.postTypes : ["educational"];
    slots.push({
      day,
      pillar: pillar.name,
      postType: postTypes[n % postTypes.length],
      topic: ideas.length > 0 ? ideas[n % ideas.length] : pillar.description,
    });
  }
  return slots;
}
