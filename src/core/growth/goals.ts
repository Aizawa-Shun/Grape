import { z } from "zod";

import { db, type Database } from "@/db/client";
import { GOAL_METRICS, type GrowthGoal } from "@/db/schema";

import { recordAction } from "./activity";

/**
 * "100人に使ってもらう" as a record: what is counted, how many, by when.
 * Progress is never typed in — it is counted from the tracking snippet's
 * events (attribution.ts), so a goal cannot be met by editing a number.
 */

export const GoalInputSchema = z.object({
  metric: z.enum(GOAL_METRICS),
  target: z.coerce.number().int().min(1).max(1_000_000),
  days: z.coerce.number().int().min(1).max(365),
});
export type GoalInput = z.infer<typeof GoalInputSchema>;

export const DEFAULT_GOAL: GoalInput = { metric: "signups", target: 100, days: 30 };

/** One active goal per product: setting a new one archives the old. */
export async function setGoal(productId: string, input: GoalInput, conn: Database = db, now: Date = new Date()): Promise<GrowthGoal> {
  const active = await conn.growthGoals.find({ where: [["productId", "==", productId], ["status", "==", "active"]] });
  for (const goal of active) await conn.growthGoals.update(goal.id, { status: "archived" });

  const goal = await conn.growthGoals.insert({
    productId,
    metric: input.metric,
    target: input.target,
    startAt: now,
    deadline: new Date(now.getTime() + input.days * 86_400_000),
    status: "active",
  });
  await recordAction(
    {
      productId,
      kind: "goal.set",
      summary: `目標を設定しました: ${input.days}日で${input.metric === "signups" ? "登録" : "訪問者"}${input.target}人`,
    },
    conn,
  );
  return goal;
}
