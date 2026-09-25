import { z } from "zod";

import { db, type Database } from "@/db/client";
import { APPROVAL_MODES, type GrowthPolicy, type Post } from "@/db/schema";

import { containsBlocked } from "./agents/opportunity-finder";

/**
 * Approval mode and the safety rules (spec §18, §26), enforced in code.
 *
 * Nothing about whether a post may go out is left to a prompt. The model
 * writes; this module decides — the same split as the approval gate in
 * core/action/execute.ts, and on top of it, not instead of it: practice mode
 * (GRAPE_ACTION_DRY_RUN) still stops every send, whatever mode is set here.
 */

export const DEFAULT_POLICY: Omit<GrowthPolicy, "id" | "productId" | "updatedAt"> = {
  approvalMode: "assisted",
  maxPostsPerDay: 2,
  maxRepliesPerDay: 5,
  minRelevance: 70,
  blockKeywords: [],
  competitorMentions: "neutral",
  promotionalIntensity: 2,
  quietHoursStart: 23,
  quietHoursEnd: 7,
};

export const PolicyInputSchema = z.object({
  approvalMode: z.enum(APPROVAL_MODES),
  maxPostsPerDay: z.coerce.number().int().min(0).max(20),
  maxRepliesPerDay: z.coerce.number().int().min(0).max(50),
  minRelevance: z.coerce.number().int().min(0).max(100),
  blockKeywords: z.array(z.string().trim().min(1).max(60)).max(50),
  competitorMentions: z.enum(["never", "neutral", "allowed"]),
  promotionalIntensity: z.coerce.number().int().min(1).max(5),
  quietHoursStart: z.coerce.number().int().min(0).max(23),
  quietHoursEnd: z.coerce.number().int().min(0).max(23),
});
export type PolicyInput = z.infer<typeof PolicyInputSchema>;

export async function getPolicy(productId: string, conn: Database = db): Promise<GrowthPolicy> {
  const stored = await conn.growthPolicies.get(productId);
  return stored ?? { id: productId, productId, updatedAt: new Date(0), ...DEFAULT_POLICY };
}

export async function savePolicy(productId: string, input: PolicyInput, conn: Database = db): Promise<GrowthPolicy> {
  return conn.growthPolicies.set(productId, { productId, ...input, updatedAt: new Date() });
}

/** The hour in Japan — the zone this app's schedule and its readers live in. */
export function tokyoHour(now: Date): number {
  return (now.getUTCHours() + 9) % 24;
}

/** The Japanese calendar day, as YYYY-MM-DD. */
export function tokyoDay(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function inQuietHours(policy: Pick<GrowthPolicy, "quietHoursStart" | "quietHoursEnd">, now: Date): boolean {
  const { quietHoursStart: start, quietHoursEnd: end } = policy;
  if (start === end) return false;
  const hour = tokyoHour(now);
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export interface GateContext {
  /** Posts/replies of this kind already sent (or practice-sent) today, Japan time. */
  sentToday: number;
  /** Set for replies: how relevant the conversation was judged. */
  relevance: number | null;
  /** True when the agent, not a person, is doing the sending. */
  automatic: boolean;
  now: Date;
}

/**
 * Every reason this post may not go out now; empty means it may.
 *
 * Daily limits and blocked words bind a person's approval too — the limits
 * exist to stop a flood, and a person clicking through a queue is exactly how
 * one happens. Quiet hours and the relevance floor bind only the agent: a
 * person replying at midnight to a thread they chose has decided both.
 */
export function publishBlockers(
  post: Pick<Post, "kind" | "text">,
  policy: GrowthPolicy,
  context: GateContext,
): string[] {
  const reasons: string[] = [];
  const limit = post.kind === "reply" ? policy.maxRepliesPerDay : policy.maxPostsPerDay;
  if (context.sentToday >= limit) {
    reasons.push(`今日の${post.kind === "reply" ? "返信" : "投稿"}は上限（${limit}件）に達しています。`);
  }
  if (containsBlocked(post.text, policy.blockKeywords)) {
    reasons.push("禁止ワードが含まれています。");
  }
  if (context.automatic) {
    if (policy.approvalMode !== "autonomous") reasons.push("自動実行はオフです（承認モードが自律ではありません）。");
    if (inQuietHours(policy, context.now)) reasons.push("投稿しない時間帯です。");
    if (post.kind === "reply" && (context.relevance ?? 0) < policy.minRelevance) {
      reasons.push(`関連度が基準（${policy.minRelevance}%）に届いていません。`);
    }
  }
  return reasons;
}

/** Posts or replies that went out (for real or in practice) on this Japanese day. */
export async function sentToday(productId: string, kind: Post["kind"], now: Date, conn: Database = db): Promise<number> {
  const day = tokyoDay(now);
  const rows = await conn.posts.find({ where: [["productId", "==", productId]] });
  return rows.filter(
    (post) =>
      post.kind === kind &&
      (post.status === "published" || (post.status === "approved" && post.dryRun)) &&
      post.decidedAt !== null &&
      tokyoDay(post.publishedAt ?? post.decidedAt) === day,
  ).length;
}
