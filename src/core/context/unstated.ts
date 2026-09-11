/**
 * What a field reads when the site never stated it.
 *
 * Its own module, with no imports, for two reasons. It is compared by string
 * equality in intelligence/audit.ts to decide whether a landing page states a
 * value proposition at all, so it has to be one literal rather than a phrase
 * two files each spell their own way. And the context editor — a client
 * component — needs it to show "未確認" in place of the sentinel, which
 * importing it from extract.ts would do by dragging zod and the extraction
 * code into the browser bundle for one string.
 */
export const UNSTATED = "サイト上に明示なし";
