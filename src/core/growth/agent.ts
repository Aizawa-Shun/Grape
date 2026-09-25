import { db, type Database } from "@/db/client";
import type { GrowthRun, GrowthRunKind, GrowthStepKind } from "@/db/schema";
import { by, firstBy } from "@/db/sort";
import { runInRequestScope } from "@/server/context";
import { describeError, log } from "@/server/log";

import { recordAction } from "./activity";
import { getPolicy } from "./policy";
import { advanceRun, createRun, driveRun, isActive, stepLabel } from "./runs";
import { executeStep, type StepServices } from "./steps";

/**
 * GrowthAgent (spec §17, §29): decides what the loop does next for a product,
 * and hands each piece to the agent that does it.
 *
 * The decision is code, from the state of the product — the same rule as
 * next-step.ts. A model choosing which step to run would make the loop's
 * behaviour change with the model's mood, and would cost a call to decide to
 * make a call.
 *
 *   initial / manual — the whole understanding: product → market →
 *     competitors → ICP → strategy → opportunities → drafts.
 *   daily — keep it moving: read the numbers on what went out, learn from
 *     them, find new conversations, top up drafts; redo the research once it
 *     is a week old; and, only under "autonomous", act within the rules.
 */

const DAY_MS = 86_400_000;
export const RESEARCH_STALE_DAYS = 7;
/** A daily run is due once the last one is this old — a little under a day, so the tick's jitter never skips one. */
const DAILY_EVERY_MS = 20 * 60 * 60 * 1000;

export const FULL_RUN: GrowthStepKind[] = ["product", "market", "competitors", "icp", "strategy", "opportunities", "content"];

export async function planSteps(
  productId: string,
  kind: GrowthRunKind,
  conn: Database = db,
  now: Date = new Date(),
): Promise<GrowthStepKind[]> {
  if (kind !== "daily") return FULL_RUN;

  const [strategies, policy, published] = await Promise.all([
    conn.strategies.find({ where: [["productId", "==", productId]] }),
    getPolicy(productId, conn),
    conn.posts.count([["productId", "==", productId], ["status", "==", "published"]]),
  ]);

  const steps: GrowthStepKind[] = [];
  if (published > 0) steps.push("metrics", "performance");
  // The research is redone from the planner's last strategy, not the learning
  // step's re-weighting of it — that one is a week's results, not new research.
  const planned = firstBy(strategies.filter((s) => s.origin === "planner"), by((s) => s.createdAt, "desc"));
  const plannerAge = planned ? now.getTime() - planned.createdAt.getTime() : Infinity;
  // A fresh competitor step re-reads every homepage anyway; otherwise the
  // watch step compares them with what they said last time.
  if (plannerAge > RESEARCH_STALE_DAYS * DAY_MS) steps.push("market", "competitors", "icp", "strategy");
  else steps.push("watch");
  steps.push("opportunities", "content");
  if (policy.approvalMode === "autonomous") steps.push("autopilot");
  return steps;
}

/** What a person can ask a manual run to do, besides the whole analysis. */
export const RUN_FOCUSES = {
  full: FULL_RUN,
  research: ["market", "competitors", "icp", "strategy"],
  opportunities: ["opportunities"],
  content: ["content"],
  learn: ["metrics", "performance"],
} as const satisfies Record<string, readonly GrowthStepKind[]>;
export type RunFocus = keyof typeof RUN_FOCUSES;

export async function startGrowthRun(
  productId: string,
  userId: string,
  kind: GrowthRunKind,
  conn: Database = db,
  focus?: RunFocus,
): Promise<{ run: GrowthRun; created: boolean }> {
  const steps = focus ? [...RUN_FOCUSES[focus]] : await planSteps(productId, kind, conn);
  const result = await createRun({ productId, userId, kind, steps }, conn);
  if (result.created) {
    await recordAction(
      {
        productId,
        runId: result.run.id,
        kind: `run.${kind}.started`,
        summary: `${kind === "daily" ? "日次の実行" : "分析"}を始めました: ${steps.map(stepLabel).join(" → ")}`,
      },
      conn,
    );
  }
  return result;
}

/** The step executor the job engine runs. */
export function growthExecutor(conn: Database = db, services: StepServices = {}) {
  return (run: GrowthRun, step: GrowthRun["steps"][number]) => executeStep(run, step.kind, conn, new Date(), services);
}

/** One step, for the progress screen's polling. */
export async function advanceGrowthRun(runId: string, conn: Database = db): Promise<GrowthRun | null> {
  return advanceRun(runId, growthExecutor(conn), conn);
}

export interface GrowthTickResult {
  started: number;
  advanced: number;
  failed: { productId: string; error: string }[];
}

/**
 * The scheduled half (called from core/loop/tick.ts). Products the owner has
 * set a growth goal for, or already built a strategy for, get a daily run;
 * runs left unfinished by a closed tab are carried on. Each runs inside its
 * owner's request scope, so model calls land on their key and their budget —
 * the same rule the diagnosis loop follows. The time budget keeps the tick
 * inside the scheduler's deadline; what does not fit waits for the next
 * caller, which the lease makes safe.
 */
export async function runGrowthTick(budgetMs: number, conn: Database = db, now: Date = new Date()): Promise<GrowthTickResult> {
  const result: GrowthTickResult = { started: 0, advanced: 0, failed: [] };
  const deadline = Date.now() + budgetMs;

  const products = await conn.products.find({ where: [["setupStatus", "==", "ready"]] });
  for (const product of products) {
    if (Date.now() >= deadline) break;
    const scope = { requestId: `growth-${crypto.randomUUID()}`, userId: product.userId };
    try {
      await runInRequestScope(scope, async () => {
        const hasKnowledge = await conn.productKnowledge.get(product.id);
        if (!hasKnowledge) return; // the first analysis is the owner's to start

        const runs = await conn.growthRuns.find({ where: [["productId", "==", product.id]] });
        let run = firstBy(runs.filter(isActive), by((r) => r.createdAt, "desc"));
        if (!run) {
          const lastDaily = firstBy(runs.filter((r) => r.kind === "daily"), by((r) => r.createdAt, "desc"));
          const lastAny = firstBy(runs, by((r) => r.createdAt, "desc"));
          const since = (lastDaily ?? lastAny)?.createdAt.getTime() ?? 0;
          if (now.getTime() - since < DAILY_EVERY_MS) return;
          run = (await startGrowthRun(product.id, product.userId, "daily", conn)).run;
          result.started += 1;
        }
        await driveRun(run.id, growthExecutor(conn), Math.max(0, deadline - Date.now()), conn);
        result.advanced += 1;
      });
    } catch (error) {
      log.warn("growth.tick_failed", { productId: product.id, ...describeError(error) });
      result.failed.push({ productId: product.id, error: String(describeError(error).error) });
    }
  }
  return result;
}
