import { AppError, toAppError } from "@/core/errors";
import { db, type Database } from "@/db/client";
import type { GrowthRun, GrowthRunKind, GrowthStep, GrowthStepKind } from "@/db/schema";
import { by, firstBy } from "@/db/sort";
import { describeForUser } from "@/server/http/errors";

import { recordAction } from "./activity";

/**
 * Jobs (spec §30, §31), shaped by where Grape runs.
 *
 * App Hosting is Cloud Run: CPU is only promised to a request in flight, so a
 * job cannot be handed to a background thread and left to finish. Instead a
 * run is a list of steps, and each step runs inside one request — whoever
 * asks first: the progress screen polling `advance`, or the scheduled tick.
 * A lease on the run (like product setup's, see core/product/register.ts)
 * keeps two requests from running the same step, and lets a step whose
 * request died be picked up again once the lease runs out.
 *
 * Steps are independent on purpose. A step that fails is retried once, and
 * then recorded as failed with its reason — and the run carries on with the
 * next: competitor research timing out must not cost the reader their ICPs
 * and their first posts. Each later step works from whatever is there.
 */

export const RUN_LEASE_MS = 5 * 60 * 1000;
export const MAX_STEP_ATTEMPTS = 2;

/** Failures a retry cannot fix: the owner's setup, not a transient fault. */
const NOT_RETRYABLE = new Set(["LLM_NOT_CONFIGURED", "LLM_BUDGET_EXCEEDED", "LLM_BILLING", "LLM_AUTH", "LLM_REFUSED", "NOT_FOUND", "CONFLICT", "POLICY_BLOCKED"]);

/** Thrown by a step with nothing to do. Recorded as skipped, with the reason, not as a failure. */
export class StepSkipped extends Error {
  constructor(readonly summary: string) {
    super(summary);
    this.name = "StepSkipped";
  }
}

export type StepExecutor = (run: GrowthRun, step: GrowthStep) => Promise<string>;

function newStep(kind: GrowthStepKind): GrowthStep {
  return { kind, status: "pending", attempts: 0, startedAt: null, finishedAt: null, summary: null, error: null };
}

export function isActive(run: Pick<GrowthRun, "status">): boolean {
  return run.status === "pending" || run.status === "running";
}

export async function latestRun(productId: string, conn: Database = db): Promise<GrowthRun | null> {
  const runs = await conn.growthRuns.find({ where: [["productId", "==", productId]] });
  return firstBy(runs, by((run) => run.createdAt, "desc"));
}

export async function activeRun(productId: string, conn: Database = db): Promise<GrowthRun | null> {
  const runs = await conn.growthRuns.find({ where: [["productId", "==", productId]] });
  return firstBy(runs.filter(isActive), by((run) => run.createdAt, "desc"));
}

/**
 * Creates a run, unless one is already going for this product — then that
 * one is returned. Two runs at once would research the same market twice and
 * leave two half-sets of results racing to be "latest".
 */
export async function createRun(
  input: { productId: string; userId: string; kind: GrowthRunKind; steps: GrowthStepKind[] },
  conn: Database = db,
): Promise<{ run: GrowthRun; created: boolean }> {
  if (input.steps.length === 0) throw new AppError("INVALID_INPUT", "A run needs at least one step");
  return conn.runTransaction(async (tx) => {
    const existing = (await tx.growthRuns.find({ where: [["productId", "==", input.productId]] })).filter(isActive);
    if (existing.length > 0) return { run: firstBy(existing, by((run) => run.createdAt, "desc"))!, created: false };
    const run = await tx.growthRuns.insert({
      productId: input.productId,
      userId: input.userId,
      kind: input.kind,
      status: "pending",
      steps: input.steps.map(newStep),
    });
    return { run, created: true };
  });
}

/** Takes the next pending step, or reports that there is nothing to take right now. */
export async function claimNextStep(
  runId: string,
  conn: Database = db,
  now: Date = new Date(),
): Promise<{ run: GrowthRun; index: number } | null> {
  return conn.runTransaction(async (tx) => {
    const run = await tx.growthRuns.get(runId);
    if (!run || !isActive(run)) return null;
    if (run.claimedAt && now.getTime() - run.claimedAt.getTime() < RUN_LEASE_MS) return null;

    // A step left "running" by a request that died is due again.
    const steps = run.steps.map((step) => (step.status === "running" ? { ...step, status: "pending" as const } : step));
    const index = steps.findIndex((step) => step.status === "pending");
    if (index === -1) {
      const finished = finalize(steps);
      await tx.growthRuns.update(runId, { steps, status: finished, claimedAt: null, finishedAt: now });
      return null;
    }

    steps[index] = { ...steps[index], status: "running", attempts: steps[index].attempts + 1, startedAt: now, error: null };
    await tx.growthRuns.update(runId, { steps, status: "running", claimedAt: now });
    return { run: { ...run, steps, status: "running", claimedAt: now }, index };
  });
}

/** A run with at least one step that did its work is a completed run, with its failures listed. */
function finalize(steps: GrowthStep[]): "completed" | "failed" {
  return steps.some((step) => step.status === "completed" || step.status === "skipped") ? "completed" : "failed";
}

const STEP_LABELS: Record<GrowthStepKind, string> = {
  product: "プロダクトの理解",
  market: "市場調査",
  competitors: "競合調査",
  audience: "狙う相手の特定",
  positioning: "ポジショニング",
  strategy: "戦略の立案",
  experiments: "仮説の設計",
  ideas: "投稿のネタ出し",
  content: "下書きの作成",
  opportunities: "見込み客の探索",
  watch: "競合の動きの確認",
  metrics: "Xの数字の取得",
  measure: "結果の計測",
  learn: "学びの記録",
  revise: "戦略の改訂",
  autopilot: "自動実行",
};

export function stepLabel(kind: GrowthStepKind): string {
  return STEP_LABELS[kind];
}

/**
 * Runs one step of a run, if one is free to run, and records how it went.
 * Returns the run as it stands afterwards. Never throws for a step's own
 * failure — that is recorded on the step, where the progress screen reads it.
 */
export async function advanceRun(
  runId: string,
  execute: StepExecutor,
  conn: Database = db,
  now: () => Date = () => new Date(),
): Promise<GrowthRun | null> {
  const claim = await claimNextStep(runId, conn, now());
  if (!claim) return conn.growthRuns.get(runId);

  const { run, index } = claim;
  const step = run.steps[index];
  let patch: Partial<GrowthStep>;

  try {
    const summary = await execute(run, step);
    patch = { status: "completed", summary, error: null };
  } catch (error) {
    if (error instanceof StepSkipped) {
      patch = { status: "skipped", summary: error.summary, error: null };
    } else {
      const appError = toAppError(error);
      const message = appError.hint ?? describeForUser(appError);
      const retry = step.attempts < MAX_STEP_ATTEMPTS && !NOT_RETRYABLE.has(appError.code);
      patch = { status: retry ? "pending" : "failed", error: message };
    }
  }

  const finishedAt = now();
  const latest = await conn.growthRuns.get(runId);
  if (!latest) return null;
  const steps = latest.steps.map((existing, i) =>
    i === index ? { ...existing, ...patch, finishedAt: patch.status === "pending" ? null : finishedAt } : existing,
  );
  const done = steps.every((s) => s.status !== "pending" && s.status !== "running");
  const updated = {
    steps,
    claimedAt: null,
    ...(done ? { status: finalize(steps), finishedAt } : {}),
  };
  await conn.growthRuns.update(runId, updated);

  if (patch.status !== "pending") {
    await recordAction(
      {
        productId: run.productId,
        runId,
        kind: `step.${step.kind}.${patch.status}`,
        summary:
          patch.status === "failed"
            ? `${stepLabel(step.kind)}に失敗しました: ${patch.error}`
            : `${stepLabel(step.kind)}: ${patch.summary}`,
      },
      conn,
    );
  }

  return { ...latest, ...updated } as GrowthRun;
}

/** Keeps advancing until the run finishes or the time budget is spent — for the scheduled tick. */
export async function driveRun(
  runId: string,
  execute: StepExecutor,
  budgetMs: number,
  conn: Database = db,
): Promise<GrowthRun | null> {
  const deadline = Date.now() + budgetMs;
  let run = await conn.growthRuns.get(runId);
  while (run && isActive(run) && Date.now() < deadline) {
    const before = JSON.stringify(run.steps.map((s) => [s.status, s.attempts]));
    run = await advanceRun(runId, execute, conn);
    // Nothing moved: another request holds the lease. Leave it to them.
    if (run && JSON.stringify(run.steps.map((s) => [s.status, s.attempts])) === before && isActive(run)) break;
  }
  return run;
}
