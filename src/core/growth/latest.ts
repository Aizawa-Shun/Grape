import { db, type Database } from "@/db/client";
import type {
  AnalyticsReport,
  Competitor,
  GrowthGoal,
  Hypothesis,
  Learning,
  MarketInsight,
  MarketingStrategy,
  Positioning,
  Segment,
} from "@/db/schema";
import { by, firstBy } from "@/db/sort";

/**
 * Reading the brain's current state.
 *
 * A research step writes a whole set of rows at once — this run's segments,
 * this run's competitors — tagged with its `runId`. The current answer is the
 * set from the most recent run that wrote any, never a union across runs: two
 * runs' competitor lists merged would list the same company twice and keep one
 * that the latest search no longer found.
 *
 * Hypotheses and learnings are the opposite: they accumulate. A learning stays
 * until a newer one on the same hypothesis supersedes it; that history is the
 * product-specific marketing knowledge Grape builds up (spec §9).
 */
export function latestSet<T extends { runId: string | null; createdAt: Date }>(rows: T[]): T[] {
  const newest = firstBy(rows, by((row) => row.createdAt, "desc"));
  if (!newest) return [];
  return rows.filter((row) => row.runId === newest.runId);
}

export async function latestSegments(productId: string, conn: Database = db): Promise<Segment[]> {
  const rows = await conn.segments.find({ where: [["productId", "==", productId]] });
  return latestSet(rows).sort(by((segment) => segment.rank));
}

export async function latestPositioning(productId: string, conn: Database = db): Promise<Positioning | null> {
  const rows = await conn.positionings.find({ where: [["productId", "==", productId]] });
  return firstBy(rows, by((row) => row.createdAt, "desc"));
}

export async function latestCompetitors(productId: string, conn: Database = db): Promise<Competitor[]> {
  const rows = await conn.competitors.find({ where: [["productId", "==", productId]] });
  return latestSet(rows).sort(by((competitor) => (competitor.verified ? 0 : 1)));
}

/**
 * Insights come from two steps — market research, and the gaps the competitor
 * step finds — so "latest" is decided per group rather than across all.
 * Competitor moves accumulate day by day and are read by watch.ts.
 */
export async function latestInsights(productId: string, conn: Database = db): Promise<MarketInsight[]> {
  const rows = await conn.marketInsights.find({ where: [["productId", "==", productId]] });
  const gaps = latestSet(rows.filter((row) => row.kind === "gap"));
  const market = latestSet(rows.filter((row) => row.kind !== "gap" && row.kind !== "competitor_move"));
  return [...market, ...gaps];
}

export async function activeStrategy(productId: string, conn: Database = db): Promise<MarketingStrategy | null> {
  const rows = await conn.strategies.find({ where: [["productId", "==", productId]] });
  return firstBy(rows, by((strategy) => strategy.version, "desc"));
}

export async function strategyHistory(productId: string, conn: Database = db): Promise<MarketingStrategy[]> {
  const rows = await conn.strategies.find({ where: [["productId", "==", productId]] });
  return rows.sort(by((strategy) => strategy.version, "desc"));
}

export async function allHypotheses(productId: string, conn: Database = db): Promise<Hypothesis[]> {
  const rows = await conn.hypotheses.find({ where: [["productId", "==", productId]] });
  return rows.sort(by((hypothesis) => hypothesis.createdAt, "desc"));
}

export async function testingHypotheses(productId: string, conn: Database = db): Promise<Hypothesis[]> {
  const rows = await conn.hypotheses.find({ where: [["productId", "==", productId], ["status", "==", "testing"]] });
  return rows.sort(by((hypothesis) => hypothesis.createdAt));
}

export async function activeLearnings(productId: string, conn: Database = db): Promise<Learning[]> {
  const rows = await conn.learnings.find({ where: [["productId", "==", productId], ["status", "==", "active"]] });
  return rows.sort(by((learning) => learning.createdAt, "desc"));
}

export async function activeGoal(productId: string, conn: Database = db): Promise<GrowthGoal | null> {
  const goals = await conn.growthGoals.find({ where: [["productId", "==", productId], ["status", "==", "active"]] });
  return firstBy(goals, by((goal) => goal.createdAt, "desc"));
}

export async function latestReport(productId: string, conn: Database = db): Promise<AnalyticsReport | null> {
  const reports = await conn.analyticsReports.find({ where: [["productId", "==", productId]] });
  return firstBy(reports, by((report) => report.createdAt, "desc"));
}
