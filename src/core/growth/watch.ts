import { db, type Database } from "@/db/client";
import type { Competitor, CompetitorSnapshot, MarketInsight } from "@/db/schema";
import { by } from "@/db/sort";

import type { PublicPage } from "./sources/page";

/**
 * Competitor movement (spec §22): noticing when a competitor changes how it
 * sells itself — a new headline, a new price, a new call to action.
 *
 * Deliberately no model. Whether a page changed is a comparison with a right
 * answer, and this runs every day for every competitor; a model would add
 * cost and nothing a diff cannot say. Each change becomes a finding the
 * reader sees in the feed, with the before and after quoted.
 */

const MAX_HEADINGS = 12;

export function snapshotOf(page: Pick<PublicPage, "title" | "meta" | "sections" | "prices" | "ctas">): CompetitorSnapshot {
  const clean = (items: string[], max: number) => [...new Set(items.map((i) => i.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, max);
  return {
    title: page.title?.trim() || null,
    description: (page.meta.description ?? page.meta["og:description"] ?? "").trim() || null,
    headings: clean(page.sections.map((s) => s.heading), MAX_HEADINGS),
    prices: clean(page.prices, 10),
    ctas: clean(page.ctas, 10),
  };
}

const quote = (text: string) => `「${text.length > 60 ? `${text.slice(0, 60)}…` : text}」`;

/** Every meaningful difference between two readings of the same page, as sentences. */
export function describeChanges(name: string, before: CompetitorSnapshot, after: CompetitorSnapshot): string[] {
  const changes: string[] = [];
  if (before.title !== after.title && after.title) {
    changes.push(`${name}がページのタイトルを変えた: ${quote(before.title ?? "なし")} → ${quote(after.title)}`);
  }
  if (before.description !== after.description && after.description) {
    changes.push(`${name}が説明文を変えた: ${quote(before.description ?? "なし")} → ${quote(after.description)}`);
  }

  const added = (a: string[], b: string[]) => b.filter((x) => !a.includes(x));
  const newHeadings = added(before.headings, after.headings);
  // A carousel or a dated heading changes daily; only a real rewrite of the
  // pitch counts — several headings at once, or the first one.
  if (newHeadings.length >= 2 || (after.headings[0] && after.headings[0] !== before.headings[0])) {
    changes.push(`${name}がトップページの見出しを書き換えた: ${newHeadings.slice(0, 3).map(quote).join("、")}`);
  }
  if (before.prices.join("|") !== after.prices.join("|") && (before.prices.length || after.prices.length)) {
    changes.push(`${name}の価格表記が変わった: ${before.prices.join(" / ") || "なし"} → ${after.prices.join(" / ") || "なし"}`);
  }
  const newCtas = added(before.ctas, after.ctas);
  if (newCtas.length > 0) changes.push(`${name}が新しい行動の呼びかけを出した: ${newCtas.slice(0, 3).map(quote).join("、")}`);
  return changes;
}

export interface WatchResult {
  checked: number;
  unreachable: number;
  moves: { competitor: Competitor; changes: string[] }[];
}

/**
 * Re-reads each competitor that has a snapshot, records what changed as
 * `competitor_move` findings, and keeps the new reading as the baseline.
 */
export async function watchCompetitors(
  competitors: Competitor[],
  fetchPage: (url: string) => Promise<PublicPage | null>,
  runId: string,
  conn: Database = db,
  now: Date = new Date(),
): Promise<WatchResult> {
  const result: WatchResult = { checked: 0, unreachable: 0, moves: [] };
  for (const competitor of competitors) {
    if (!competitor.url || !competitor.snapshot) continue;
    const page = await fetchPage(competitor.url);
    if (!page) {
      result.unreachable += 1;
      continue;
    }
    result.checked += 1;
    const snapshot = snapshotOf(page);
    const changes = describeChanges(competitor.name, competitor.snapshot, snapshot);
    await conn.competitors.update(competitor.id, { snapshot, snapshotAt: now });
    if (changes.length === 0) continue;

    result.moves.push({ competitor, changes });
    await conn.marketInsights.insert({
      productId: competitor.productId,
      runId,
      kind: "competitor_move",
      statement: changes.join("\n"),
      userPhrases: [],
      sources: [{ url: page.url, title: `${competitor.name} 公式サイト` }],
      grounded: true,
    });
  }
  return result;
}

/** Competitor moves of the last `days` — accumulated, unlike research findings, which are replaced per run. */
export async function recentMoves(productId: string, days = 14, conn: Database = db, now: Date = new Date()): Promise<MarketInsight[]> {
  const since = now.getTime() - days * 86_400_000;
  const rows = await conn.marketInsights.find({ where: [["productId", "==", productId], ["kind", "==", "competitor_move"]] });
  return rows.filter((row) => row.createdAt.getTime() >= since).sort(by((row) => row.createdAt, "desc"));
}
