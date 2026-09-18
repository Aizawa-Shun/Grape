import { eq } from "drizzle-orm";

import { AppError } from "@/core/errors";
import { currentSettings } from "@/core/settings";
import { db, schema, type Database } from "@/db/client";
import { log } from "@/server/log";

import { estimateActionCostUsd } from "./channel";
import { getChannel } from "./channels";

/**
 * The approval gate. Every task in this codebase up to here — diagnose,
 * recommend, generate — only ever reads and reasons; nothing leaves the
 * process. This is the one place that changes: a real POST to a real API,
 * with a real and non-refundable cost on the X channel (see channels/x.ts).
 *
 * Two independent safety properties, not one:
 *   1. A human calls this — nothing in Grape auto-approves a task.
 *   2. Even once approved, GRAPE_ACTION_DRY_RUN (default true) still stops an
 *      `x` send short of the network call and just logs what would have gone
 *      out. Flipping it to `false` is a deliberate, separate decision from
 *      writing the artifact or clicking approve — made through the confirm-
 *      gated control on /settings (see settings/dry-run-toggle.tsx) or by
 *      editing .env directly, never as a side effect of anything in this file.
 *      Read through `currentSettings()`, not the raw `env` import, so a
 *      change made from /settings takes effect on the very next approval
 *      without a restart.
 * The `manual` channel has no network call to gate — see channels/manual.ts —
 * so dry-run does not apply to it; approving a manual task always finishes it.
 */

export type ActionRun = typeof schema.actionRuns.$inferSelect;
export type Task = typeof schema.tasks.$inferSelect;

export interface ExecuteOptions {
  database?: Database;
}

export async function approveAndExecute(
  taskId: string,
  artifactId: string,
  options: ExecuteOptions = {},
): Promise<ActionRun> {
  const conn = options.database ?? db;

  const task = await conn.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!task) throw new AppError("NOT_FOUND", `Unknown task: ${taskId}`);
  // Guards against a double click re-sending an already-sent post — on the x
  // channel that would be a second real, billed, public post, not a no-op.
  if (task.status === "done") throw new AppError("CONFLICT", `Task ${taskId} is already done`);
  if (task.status === "skipped") throw new AppError("CONFLICT", `Task ${taskId} was skipped`);

  const artifact = await conn.query.artifacts.findFirst({ where: eq(schema.artifacts.id, artifactId) });
  if (!artifact || artifact.taskId !== taskId) {
    throw new AppError("INVALID_INPUT", `Artifact ${artifactId} does not belong to task ${taskId}`);
  }

  // Deliberately not `getChannel(task.channel)` here — that requires real
  // credentials to even construct, which would make dry-run (the whole point
  // of which is to exercise this path with nothing configured yet) demand
  // the very credentials it exists to let you postpone.
  const costEstimateUsd = estimateActionCostUsd(task.channel, artifact.content);
  const approvedAt = new Date();

  const [run] = await conn
    .insert(schema.actionRuns)
    .values({
      taskId,
      artifactId,
      channel: task.channel,
      payload: { content: artifact.content },
      status: "pending",
      costEstimateUsd,
      approvedAt,
    })
    .returning();

  const dryRun = task.channel !== "manual" && currentSettings().GRAPE_ACTION_DRY_RUN;

  if (dryRun) {
    // The one place dry-run's effect is actually visible: this is what a real
    // send would have posted, with nowhere else it is shown before this point.
    // Never truncate `content` — showing it in full is the entire purpose.
    log.info("action.dry_run", { channel: task.channel, taskId, content: artifact.content });
    return finish(conn, run.id, taskId, { status: "dry_run" });
  }

  try {
    // getChannel("x") requires real credentials and throws without them —
    // correctly so here, since reaching this line means dry-run did NOT
    // intercept the send (manual, or x with dry-run explicitly off), so a
    // real network call is genuinely about to happen.
    const channel = getChannel(task.channel);
    const result = await channel.execute(artifact.content);
    return finish(conn, run.id, taskId, {
      status: "sent",
      externalUrl: result.externalUrl,
      response: result.response,
    });
  } catch (error) {
    // Deliberately does not touch task.status: a failed send is retryable —
    // generate a fresh approval, or the same artifact again — not a dead end.
    await conn
      .update(schema.actionRuns)
      .set({ status: "failed", executedAt: new Date(), response: { error: describeError(error) } })
      .where(eq(schema.actionRuns.id, run.id));
    throw error;
  }
}

async function finish(
  conn: Database,
  runId: string,
  taskId: string,
  fields: { status: "dry_run" | "sent"; externalUrl?: string | null; response?: unknown },
): Promise<ActionRun> {
  const executedAt = new Date();
  const [updated] = await conn
    .update(schema.actionRuns)
    .set({ ...fields, executedAt })
    .where(eq(schema.actionRuns.id, runId))
    .returning();
  await conn.update(schema.tasks).set({ status: "done", completedAt: executedAt }).where(eq(schema.tasks.id, taskId));
  return updated;
}

export async function skipTask(taskId: string, options: ExecuteOptions = {}): Promise<Task> {
  const conn = options.database ?? db;
  const [row] = await conn
    .update(schema.tasks)
    .set({ status: "skipped" })
    .where(eq(schema.tasks.id, taskId))
    .returning();
  if (!row) throw new AppError("NOT_FOUND", `Unknown task: ${taskId}`);
  return row;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}
