/**
 * Sorting in code, for the queries that deliberately do not sort in
 * Firestore.
 *
 * Firestore can only order an equality-filtered query by another field when
 * a composite index for exactly that pair exists — and the emulator does not
 * enforce indexes, so a missing one passes every test and fails only in
 * production. Per-product collections (tasks, contexts, diagnoses, runs) are
 * small, so those queries filter by equality alone and sort here; only the
 * collections that grow without bound (events, llmCalls) order and range in
 * Firestore, against indexes firestore.indexes.json declares.
 */
export function by<T>(key: (item: T) => Date | number | string | null, direction: "asc" | "desc" = "asc") {
  return (a: T, b: T): number => {
    const left = key(a);
    const right = key(b);
    const l = left instanceof Date ? left.getTime() : left;
    const r = right instanceof Date ? right.getTime() : right;
    if (l === r) return 0;
    // Nulls first ascending, last descending — the order Firestore uses.
    if (l === null) return direction === "asc" ? -1 : 1;
    if (r === null) return direction === "asc" ? 1 : -1;
    const order = l < r ? -1 : 1;
    return direction === "asc" ? order : -order;
  };
}

/** The item a comparator puts first, or null for an empty list. */
export function firstBy<T>(items: T[], compare: (a: T, b: T) => number): T | null {
  return items.length === 0 ? null : [...items].sort(compare)[0];
}
