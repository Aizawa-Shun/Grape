/**
 * How long X thinks a post is.
 *
 * Not `.length`. X weighs every character outside a few Latin and punctuation
 * ranges as 2 — so a Japanese post runs out at 140 characters, not 280 — and
 * counts every URL as 23 however long it really is (it is wrapped in t.co).
 * Measuring with `.length` let a Japanese draft through that X would refuse,
 * and would have refused an English post whose only length was a tracking
 * link. These are the ranges twitter-text publishes for its v3 config.
 */

export const X_WEIGHTED_LIMIT = 280;
const URL_WEIGHT = 23;
const URL_PATTERN = /https?:\/\/[^\s]+/g;

const LIGHT_RANGES: [number, number][] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

function weightOf(codePoint: number): number {
  return LIGHT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end) ? 1 : 2;
}

export function xWeightedLength(text: string): number {
  let total = 0;
  const withoutUrls = text.replace(URL_PATTERN, () => {
    total += URL_WEIGHT;
    return "";
  });
  for (const char of withoutUrls.normalize("NFC")) total += weightOf(char.codePointAt(0) ?? 0);
  return total;
}

/**
 * Cuts `text` so that it, plus `reserve` weight for whatever is appended
 * afterwards (a link: 24 with its space), fits. Cuts at a line or sentence
 * break when one is near, and marks the cut with an ellipsis otherwise.
 */
export function fitToX(text: string, reserve = 0, limit = X_WEIGHTED_LIMIT): string {
  const budget = limit - reserve;
  if (xWeightedLength(text) <= budget) return text;

  const chars = [...text];
  let kept = "";
  for (const char of chars) {
    if (xWeightedLength(kept + char) > budget - 1) break;
    kept += char;
  }
  const breakAt = Math.max(kept.lastIndexOf("\n"), kept.lastIndexOf("。"), kept.lastIndexOf(". "));
  if (breakAt > kept.length * 0.6) return kept.slice(0, breakAt + 1).trimEnd();
  return kept.trimEnd() + "…";
}
