import { ChannelError } from "@/core/action/channel";
import { estimateXPostCostUsd, sendTweet, xCredentialsFrom } from "@/core/action/channels/x";
import { xWeightedLength, X_WEIGHTED_LIMIT } from "@/core/action/channels/x-text";
import { AppError } from "@/core/errors";
import { currentSettings } from "@/core/settings";
import { db, type Database } from "@/db/client";
import type { Post } from "@/db/schema";
import { env } from "@/env";

import { recordAction } from "./activity";
import { getPolicy, publishBlockers, sentToday } from "./policy";
import { xStatusId } from "./tracking";

/**
 * Approve → publish, for the growth loop's posts and replies.
 *
 * Mirrors core/action/execute.ts in its two safety properties and adds the
 * policy gate between them:
 *   1. Someone decides — a person, or the agent under an explicit
 *      "autonomous" setting (the `automatic` flag), which the gate holds to
 *      stricter rules (quiet hours, the relevance floor).
 *   2. Practice mode still wins. With GRAPE_ACTION_DRY_RUN on, an approved
 *      post is recorded as approved-in-practice and nothing leaves: it is not
 *      "published", so it is never measured as though it had been.
 *
 * Replies to conversations that are not on X (Hacker News, a forum) have no
 * API to send through. Approving one marks it ready; the person posts it
 * themselves and says so (`markPublished`).
 */

export type Sender = (text: string, replyToId: string | null) => Promise<{ id: string; externalUrl: string }>;

function defaultSender(): Sender {
  return async (text, replyToId) => {
    const credentials = xCredentialsFrom(env);
    if (!credentials) {
      throw new ChannelError("X posting credentials are not configured", "x", "auth");
    }
    return sendTweet(credentials, text, replyToId);
  };
}

export interface ApproveOptions {
  /** The text as the person edited it on the approval card. */
  text?: string;
  automatic?: boolean;
  now?: Date;
  database?: Database;
  sender?: Sender;
}

async function loadPost(postId: string, conn: Database): Promise<Post> {
  const post = await conn.posts.get(postId);
  if (!post) throw new AppError("NOT_FOUND", `Unknown post: ${postId}`);
  return post;
}

/** Whether this post goes out through X's API, as opposed to by hand somewhere else. */
async function sendsViaX(post: Post, conn: Database): Promise<boolean> {
  if (post.kind === "post") return true;
  if (!post.opportunityId) return false;
  const opportunity = await conn.opportunities.get(post.opportunityId);
  return opportunity?.source === "x";
}

export async function approvePost(postId: string, options: ApproveOptions = {}): Promise<Post> {
  const conn = options.database ?? db;
  const now = options.now ?? new Date();
  const post = await loadPost(postId, conn);

  const reopenable = post.status === "draft" || post.status === "failed" || (post.status === "approved" && post.dryRun);
  if (!reopenable) throw new AppError("CONFLICT", `Post ${postId} is ${post.status}`);

  const text = (options.text ?? post.text).trim();
  const viaX = await sendsViaX(post, conn);
  if (!text) throw new AppError("INVALID_INPUT", "Empty post");
  if (viaX && xWeightedLength(text) > X_WEIGHTED_LIMIT) {
    throw new AppError("INVALID_INPUT", "Post exceeds X's weighted limit", {
      hint: "Xの文字数上限を超えています（日本語などの全角は1字を2と数えます）。",
    });
  }

  const policy = await getPolicy(post.productId, conn);
  const opportunity = post.opportunityId ? await conn.opportunities.get(post.opportunityId) : null;
  const blockers = publishBlockers({ kind: post.kind, text }, policy, {
    sentToday: await sentToday(post.productId, post.kind, now, conn),
    relevance: opportunity?.relevance ?? null,
    automatic: options.automatic ?? false,
    now,
  });
  if (blockers.length > 0) {
    throw new AppError("POLICY_BLOCKED", `Blocked by policy: ${blockers.join(" ")}`, { hint: blockers.join(" ") });
  }

  const base = { text, decidedAt: now, costEstimateUsd: viaX ? estimateXPostCostUsd(text) : 0, error: null };
  const who = options.automatic ? "エージェントが" : "";

  if (!viaX) {
    const updated = await conn.posts.update(postId, { ...base, status: "approved", dryRun: false });
    await recordAction({ productId: post.productId, runId: post.runId, kind: "reply.approved", summary: `${who}返信を承認しました（自分で投稿してください）` }, conn);
    return { ...post, ...updated } as Post;
  }

  if (currentSettings().GRAPE_ACTION_DRY_RUN) {
    const updated = await conn.posts.update(postId, { ...base, status: "approved", dryRun: true });
    await recordAction(
      {
        productId: post.productId,
        runId: post.runId,
        kind: `${post.kind}.practice`,
        summary: `${who}${post.kind === "reply" ? "返信" : "投稿"}を承認しました（練習モードのため送信していません）`,
        detail: { text },
      },
      conn,
    );
    return { ...post, ...updated } as Post;
  }

  try {
    const sent = await (options.sender ?? defaultSender())(text, post.kind === "reply" ? post.replyToExternalId : null);
    const updated = await conn.posts.update(postId, {
      ...base,
      status: "published",
      dryRun: false,
      externalId: sent.id,
      externalUrl: sent.externalUrl,
      publishedAt: now,
    });
    if (post.opportunityId) await conn.opportunities.update(post.opportunityId, { status: "replied" });
    await recordAction(
      {
        productId: post.productId,
        runId: post.runId,
        kind: `${post.kind}.published`,
        summary: `${who}Xに${post.kind === "reply" ? "返信" : "投稿"}しました`,
        detail: { url: sent.externalUrl },
      },
      conn,
    );
    return { ...post, ...updated } as Post;
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    await conn.posts.update(postId, { ...base, status: "failed", error: message });
    await recordAction({ productId: post.productId, runId: post.runId, kind: `${post.kind}.failed`, summary: `Xへの送信に失敗しました: ${message}` }, conn);
    throw error;
  }
}

/** The person posted it themselves — through X's composer, or on the forum it replies to. */
export async function markPublished(
  postId: string,
  externalUrl: string | null,
  options: { now?: Date; database?: Database } = {},
): Promise<Post> {
  const conn = options.database ?? db;
  const now = options.now ?? new Date();
  const post = await loadPost(postId, conn);
  if (post.status === "published" || post.status === "rejected") {
    throw new AppError("CONFLICT", `Post ${postId} is ${post.status}`);
  }
  const updated = await conn.posts.update(postId, {
    status: "published",
    dryRun: false,
    decidedAt: post.decidedAt ?? now,
    publishedAt: now,
    externalUrl,
    externalId: externalUrl ? xStatusId(externalUrl) : null,
    error: null,
  });
  if (post.opportunityId) await conn.opportunities.update(post.opportunityId, { status: "replied" });
  await recordAction(
    { productId: post.productId, runId: post.runId, kind: `${post.kind}.published_manually`, summary: `${post.kind === "reply" ? "返信" : "投稿"}を自分で公開したと記録しました` },
    conn,
  );
  return { ...post, ...updated } as Post;
}

/**
 * Rejections are kept, with the reason: they are part of Agent Memory (spec
 * §25) — the next ContentGenerator run is told what was turned down and why.
 */
export async function rejectPost(postId: string, reason: string, options: { now?: Date; database?: Database } = {}): Promise<Post> {
  const conn = options.database ?? db;
  const post = await loadPost(postId, conn);
  if (post.status === "published") throw new AppError("CONFLICT", `Post ${postId} is already published`);
  const updated = await conn.posts.update(postId, {
    status: "rejected",
    decidedAt: options.now ?? new Date(),
    error: reason.trim() || null,
  });
  await recordAction(
    { productId: post.productId, runId: post.runId, kind: `${post.kind}.rejected`, summary: `${post.kind === "reply" ? "返信" : "投稿"}案を見送りました${reason.trim() ? `（${reason.trim()}）` : ""}` },
    conn,
  );
  return { ...post, ...updated } as Post;
}
