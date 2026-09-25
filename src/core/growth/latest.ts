import { db, type Database } from "@/db/client";
import type { AnalyticsReport, Competitor, GrowthGoal, Icp, MarketInsight, MarketingStrategy } from "@/db/schema";
import { by, firstBy } from "@/db/sort";

/**
 * A research step writes a whole set of rows at once — this run's ICPs, this
 * run's competitors — tagged with its `runId`. The current answer is the set
 * from the most recent run that wrote any, never a union across runs: two
 * runs' competitor lists merged would list the same company twice and keep one
 * that the latest search no longer found.
 */
export function latestSet<T extends { runId: string | null; createdAt: Date }>(rows: T[]): T[] {
  const newest = firstBy(rows, by((row) => row.createdAt, "desc"));
  if (!newest) return [];
  return rows.filter((row) => row.runId === newest.runId);
}

export async function latestIcps(productId: string, conn: Database = db): Promise<Icp[]> {
  const rows = await conn.icps.find({ where: [["productId", "==", productId]] });
  return latestSet(rows).sort(by((icp) => icp.rank));
}

export async function latestCompetitors(productId: string, conn: Database = db): Promise<Competitor[]> {
  const rows = await conn.competitors.find({ where: [["productId", "==", productId]] });
  return latestSet(rows).sort(by((competitor) => (competitor.verified ? 0 : 1)));
}

/**
 * Insights come from two steps — market research, and the gaps the competitor
 * step finds — so "latest" is decided per kind group rather than across all.
 */
export async function latestInsights(productId: string, conn: Database = db): Promise<MarketInsight[]> {
  const rows = await conn.marketInsights.find({ where: [["productId", "==", productId]] });
  const gaps = latestSet(rows.filter((row) => row.kind === "gap"));
  const market = latestSet(rows.filter((row) => row.kind !== "gap"));
  return [...market, ...gaps];
}

export async function activeStrategy(productId: string, conn: Database = db): Promise<MarketingStrategy | null> {
  const rows = await conn.strategies.find({ where: [["productId", "==", productId]] });
  return firstBy(rows, by((strategy) => strategy.version, "desc"));
}

export async function activeGoal(productId: string, conn: Database = db): Promise<GrowthGoal | null> {
  const goals = await conn.growthGoals.find({ where: [["productId", "==", productId], ["status", "==", "active"]] });
  return firstBy(goals, by((goal) => goal.createdAt, "desc"));
}

export async function latestReport(productId: string, conn: Database = db): Promise<AnalyticsReport | null> {
  const reports = await conn.analyticsReports.find({ where: [["productId", "==", productId]] });
  return firstBy(reports, by((report) => report.createdAt, "desc"));
}
