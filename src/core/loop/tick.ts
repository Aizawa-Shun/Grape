import { and, eq, isNotNull, lte, notExists } from "drizzle-orm";

import { toAppError } from "@/core/errors";
import { diagnoseProduct } from "@/core/intelligence/diagnose";
import { DEFAULT_WINDOW_DAYS, evaluateOutcome } from "@/core/intelligence/outcomes";
import { recommendTasks } from "@/core/intelligence/recommend";
import { llmAvailable } from "@/core/llm";
import { DIAGNOSIS_STALE_DAYS } from "@/core/product/next-step";
import { db, schema, type Database } from "@/db/client";
import { runInRequestScope } from "@/server/context";
import { describeError, log } from "@/server/log";

/**
 * One turn of the weekly loop, run on a schedule rather than by a person.
 *
 * README step 6 — "7日後に効果を測り、その結果が次の診断に入ります" — and
 * render.yaml's "scheduled loop" both described this, and nothing did it: the
 * outcome of a task was measured only if someone came back and pressed 測る,
 * and a product was re-diagnosed only if someone pressed 調べ直す. Two jobs:
 *
 *   1. Measure. Every task finished at least DEFAULT_WINDOW_DAYS ago and not
 *      yet measured gets its outcome. Arithmetic over the funnel — no model,
 *      no cost — so it runs for every account.
 *   2. Re-diagnose. Every product whose latest diagnosis is older than
 *      DIAGNOSIS_STALE_DAYS gets a new one, with the outcomes from step 1
 *      already in hand (diagnose.ts reads them). Only products that have been
 *      diagnosed at least once: the first diagnosis spends the owner's money
 *      and is theirs to ask for.
 *
 * Step 2 runs inside the product owner's own request scope, so the model is
 * called on *their* API key and counted against *their* monthly ceiling —
 * exactly as if they had pressed the button (see core/llm/index.ts and
 * core/llm/budget.ts). An owner with no key on file, or over budget, is
 * skipped and reported, not treated as a failure of the run.
 *
 * Nothing here posts, approves or sends. Generating and executing a task
 * stays a human decision; the loop only keeps the reading current.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LoopTickResult {
  measured: number;
  diagnosed: number;
  /** Not attempted, and why — expected states, not errors. */
  skipped: { productId: string; reason: string }[];
  /** Attempted and failed. The rest of the run carried on regardless. */
  failed: { productId?: string; taskId?: string; error: string }[];
}

export interface LoopTickOptions {
  now?: Date;
  database?: Database;
  /** Injectable so the selection logic can be tested without a funnel. */
  measure?: (taskId: string, now: Date) => Promise<unknown>;
  /** Injectable for the same reason; runs inside the owner's request scope. */
  rediagnose?: (productId: string) => Promise<unknown>;
}

async function defaultRediagnose(productId: string): Promise<void> {
  const diagnosis = await diagnoseProduct(productId);
  await recommendTasks(diagnosis);
}

/** Reasons a re-diagnosis is skipped rather than failed — the owner's setup, not a fault. */
const SKIP_CODES = new Set(["LLM_NOT_CONFIGURED", "LLM_BUDGET_EXCEEDED"]);

let running = false;

export async function runLoopTick(options: LoopTickOptions = {}): Promise<LoopTickResult> {
  // A second tick arriving while one is still working (a slow model, a retry
  // from the scheduler) would diagnose the same products twice. One at a time
  // per process; a cross-process overlap is harmless for measuring, and the
  // staleness check below makes a double diagnosis a narrow race at worst.
  if (running) {
    return { measured: 0, diagnosed: 0, skipped: [{ productId: "*", reason: "already running" }], failed: [] };
  }
  running = true;
  try {
    const result = await tick(options);
    log.info("loop.tick", {
      measured: result.measured,
      diagnosed: result.diagnosed,
      skipped: result.skipped.length,
      failed: result.failed.length,
    });
    return result;
  } finally {
    running = false;
  }
}

async function tick(options: LoopTickOptions): Promise<LoopTickResult> {
  const conn = options.database ?? db;
  const now = options.now ?? new Date();
  const measure =
    options.measure ?? ((taskId: string, at: Date) => evaluateOutcome(taskId, { now: at, database: conn }));
  const rediagnose = options.rediagnose ?? defaultRediagnose;

  const result: LoopTickResult = { measured: 0, diagnosed: 0, skipped: [], failed: [] };

  // --- 1. Measure -----------------------------------------------------------
  const due = await conn.query.tasks.findMany({
    where: and(
      eq(schema.tasks.status, "done"),
      isNotNull(schema.tasks.completedAt),
      lte(schema.tasks.completedAt, new Date(now.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS)),
      notExists(
        conn
          .select({ id: schema.outcomes.id })
          .from(schema.outcomes)
          .where(eq(schema.outcomes.taskId, schema.tasks.id)),
      ),
    ),
    columns: { id: true },
  });

  for (const task of due) {
    try {
      await measure(task.id, now);
      result.measured += 1;
    } catch (error) {
      result.failed.push({ taskId: task.id, error: String(describeError(error).error) });
    }
  }

  // --- 2. Re-diagnose -------------------------------------------------------
  if (!llmAvailable()) {
    result.skipped.push({ productId: "*", reason: "AI is not configured for this instance" });
    return result;
  }

  const products = await conn.query.products.findMany({
    where: eq(schema.products.setupStatus, "ready"),
    columns: { id: true, userId: true },
  });
  const staleBefore = now.getTime() - DIAGNOSIS_STALE_DAYS * DAY_MS;

  for (const product of products) {
    const latest = await conn.query.diagnoses.findFirst({
      where: eq(schema.diagnoses.productId, product.id),
      orderBy: (diagnoses, { desc }) => [desc(diagnoses.createdAt)],
      columns: { createdAt: true },
    });
    if (!latest) continue; // never diagnosed: the first one is the owner's call
    if (latest.createdAt.getTime() > staleBefore) continue;

    const scope = { requestId: `loop-${crypto.randomUUID()}`, userId: product.userId };
    try {
      await runInRequestScope(scope, () => rediagnose(product.id));
      result.diagnosed += 1;
    } catch (error) {
      const appError = toAppError(error);
      if (SKIP_CODES.has(appError.code)) {
        result.skipped.push({ productId: product.id, reason: appError.code });
      } else {
        result.failed.push({ productId: product.id, error: String(describeError(error).error) });
      }
    }
  }

  return result;
}
