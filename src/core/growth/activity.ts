import { db, type Database } from "@/db/client";
import type { AgentAction } from "@/db/schema";
import { by } from "@/db/sort";
import { describeError, log } from "@/server/log";

/**
 * The Activity Log (spec §24): everything the agent did, in a sentence each.
 *
 * Written as it happens, never reconstructed afterwards, so the log is a
 * record rather than a story. A failure to write it must never fail the work
 * it describes — it is logged and dropped.
 */
export async function recordAction(
  entry: { productId: string; runId?: string | null; kind: string; summary: string; detail?: unknown },
  conn: Database = db,
): Promise<void> {
  try {
    await conn.agentActions.insert({
      productId: entry.productId,
      runId: entry.runId ?? null,
      kind: entry.kind,
      summary: entry.summary,
      detail: entry.detail ?? null,
    });
  } catch (error) {
    log.warn("growth.activity_write_failed", describeError(error));
  }
}

export async function recentActions(productId: string, limit = 30, conn: Database = db): Promise<AgentAction[]> {
  const rows = await conn.agentActions.find({ where: [["productId", "==", productId]] });
  return rows.sort(by((row) => row.createdAt, "desc")).slice(0, limit);
}
