import { and, desc, eq, inArray } from "drizzle-orm";

import { getFunnelForRange } from "@/core/data/funnel";
import { AppError } from "@/core/errors";
import { db, schema, type Database } from "@/db/client";
import type { FunnelStage } from "@/db/schema";
import type { FunnelResult } from "@/core/data/funnel";

/**
 * Closes the loop (spec's ⑤ LEARN): did a completed task actually move the
 * stage its diagnosis targeted? Measured the same deterministic way as the
 * bottleneck itself — funnel.ts's session counts, before vs. after — rather
 * than trying to parse the LLM's free-text `expectedMetric` back into a
 * query. `task.stage` already is the structured, queryable version of "what
 * this was supposed to move"; `expectedMetric` stays on the task as the
 * human-readable record of what recommend.ts said it hoped for.
 */

export type Outcome = typeof schema.outcomes.$inferSelect;

/** How long to wait, before and after completion, for a fair comparison. Matches the retention window's own 7-day convention. */
export const DEFAULT_WINDOW_DAYS = 7;

export function sessionsForStage(funnel: FunnelResult, stage: FunnelStage): number {
  // Reach has no row of its own in funnel.stages — by construction every
  // session that reaches the site is a visit, so Reach's count is the same
  // total (see funnel.ts). audit-mode diagnoses always target "reach".
  if (stage === "reach") return funnel.totalSessions;
  return funnel.stages.find((s) => s.stage === stage)?.sessions ?? 0;
}

export interface EvaluateOutcomeOptions {
  windowDays?: number;
  /** Injectable for tests; defaults to the real clock. */
  now?: Date;
  database?: Database;
}

export async function evaluateOutcome(taskId: string, options: EvaluateOutcomeOptions = {}): Promise<Outcome> {
  const conn = options.database ?? db;
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const now = options.now ?? new Date();

  const task = await conn.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!task) throw new AppError("NOT_FOUND", `Unknown task: ${taskId}`);
  if (task.status !== "done" || !task.completedAt) {
    throw new AppError("CONFLICT", `Task ${taskId} is not done yet — nothing to evaluate`);
  }

  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const afterWindowEnd = new Date(task.completedAt.getTime() + windowMs);

  if (now < afterWindowEnd) {
    const daysLeft = Math.ceil((afterWindowEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    throw new AppError(
      "TOO_EARLY",
      `Too early to evaluate task ${taskId} — needs ${daysLeft} more day(s) of data after completion`,
      { hint: `あと${daysLeft}日` },
    );
  }

  const beforeWindowStart = new Date(task.completedAt.getTime() - windowMs);
  const [beforeFunnel, afterFunnel] = await Promise.all([
    getFunnelForRange(task.productId, beforeWindowStart, task.completedAt),
    getFunnelForRange(task.productId, task.completedAt, afterWindowEnd),
  ]);

  const before = sessionsForStage(beforeFunnel, task.stage);
  const after = sessionsForStage(afterFunnel, task.stage);

  const [row] = await conn
    .insert(schema.outcomes)
    .values({
      taskId,
      metric: `${task.stage} sessions`,
      before,
      after,
      windowDays,
      delta: after - before,
    })
    .returning();

  return row;
}

export interface PastOutcome {
  taskTitle: string;
  stage: FunnelStage;
  expectedMetric: string;
  expectedDirection: "up" | "down";
  before: number;
  after: number;
  delta: number;
  windowDays: number;
}

/**
 * What diagnose.ts reads to make re-diagnosis an actual re-diagnosis rather
 * than the same reasoning run again on fresher numbers: what was tried
 * before, and whether it worked. Without this, two runs a week apart read
 * identically to the model except for the raw counts.
 */
export async function getRecentOutcomes(
  productId: string,
  limit = 5,
  database?: Database,
): Promise<PastOutcome[]> {
  const conn = database ?? db;

  // Done only. A practice-mode approval is `approved`, never `done` (see
  // action/execute.ts), and nothing it "caused" belongs in the evidence a
  // diagnosis reasons from.
  const doneTasks = await conn.query.tasks.findMany({
    where: and(eq(schema.tasks.productId, productId), eq(schema.tasks.status, "done")),
    orderBy: (tasks, { desc }) => [desc(tasks.completedAt)],
  });
  if (doneTasks.length === 0) return [];

  // One query for every outcome rather than one per task: newest first, so
  // the first row seen for a task is its latest measurement.
  const outcomes = await conn.query.outcomes.findMany({
    where: inArray(
      schema.outcomes.taskId,
      doneTasks.map((task) => task.id),
    ),
    orderBy: [desc(schema.outcomes.evaluatedAt)],
  });
  const latestByTask = new Map<string, Outcome>();
  for (const outcome of outcomes) {
    if (!latestByTask.has(outcome.taskId)) latestByTask.set(outcome.taskId, outcome);
  }

  const results: PastOutcome[] = [];
  for (const task of doneTasks) {
    if (results.length >= limit) break;
    const outcome = latestByTask.get(task.id);
    if (!outcome) continue;
    results.push({
      taskTitle: task.title,
      stage: task.stage,
      expectedMetric: task.expectedMetric,
      expectedDirection: task.expectedDirection,
      before: outcome.before,
      after: outcome.after,
      delta: outcome.delta,
      windowDays: outcome.windowDays,
    });
  }
  return results;
}
