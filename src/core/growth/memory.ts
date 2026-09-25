import { db, type Database } from "@/db/client";
import type { Post } from "@/db/schema";
import { by } from "@/db/sort";

import { attributionFor, type PostAttribution } from "./attribution";
import { latestReport } from "./latest";

/**
 * Agent Memory (spec §25): what the loop has learned about this product and
 * this person, so no draft starts from zero.
 *
 * Built from what happened rather than from what a model once concluded:
 * which published hooks brought visits and signups, which did nothing, what
 * was turned down and why, and — the most direct signal of taste there is —
 * how the person rewrote a draft before approving it. The latest analysis's
 * conclusions ride along, but the raw outcomes come first.
 *
 * Everything here is selected and ranked in code. The writers are only shown
 * it (renderMemory); they never decide what is remembered.
 */

export interface RememberedPost {
  hook: string;
  text: string;
  outcome: string;
}

export interface Rewrite {
  kind: Post["kind"];
  before: string;
  after: string;
}

export interface AgentMemory {
  worked: RememberedPost[];
  didNotWork: RememberedPost[];
  rejected: { kind: Post["kind"]; text: string; reason: string }[];
  rewrites: Rewrite[];
  conclusions: string[];
}

const LIMIT = 4;

function outcomeOf(post: Post, attribution: PostAttribution | undefined): string {
  const parts: string[] = [];
  if (post.metrics?.impressions != null) parts.push(`表示${post.metrics.impressions}`);
  if (post.metrics?.likes != null) parts.push(`いいね${post.metrics.likes}`);
  parts.push(`訪問${attribution?.visits ?? 0}`, `登録${attribution?.signups ?? 0}`);
  return parts.join(" / ");
}

function valueOf(post: Post, attribution: PostAttribution | undefined): number {
  const engagements = (post.metrics?.likes ?? 0) + (post.metrics?.replies ?? 0) + (post.metrics?.reposts ?? 0);
  return (attribution?.signups ?? 0) * 100 + (attribution?.visits ?? 0) * 10 + engagements;
}

/** A rewrite worth remembering changed more than whitespace. */
export function isRealRewrite(before: string, after: string): boolean {
  const norm = (text: string) => text.replace(/\s+/g, " ").trim();
  return norm(before) !== norm(after);
}

export async function buildAgentMemory(productId: string, conn: Database = db): Promise<AgentMemory> {
  const posts = await conn.posts.find({ where: [["productId", "==", productId]] });
  const published = posts.filter((p) => p.status === "published" && p.kind === "post");
  const attribution = await attributionFor(productId, published, conn);

  // Only posts that have had a chance: a result, or a day in public.
  const dayAgo = Date.now() - 86_400_000;
  const measured = published.filter((p) => p.metrics || (p.publishedAt && p.publishedAt.getTime() < dayAgo));
  const ranked = [...measured].sort((a, b) => valueOf(b, attribution.get(b.id)) - valueOf(a, attribution.get(a.id)));
  const remember = (post: Post): RememberedPost => ({ hook: post.hook, text: post.text, outcome: outcomeOf(post, attribution.get(post.id)) });

  const worked = ranked.filter((p) => valueOf(p, attribution.get(p.id)) > 0).slice(0, LIMIT).map(remember);
  const didNotWork = ranked
    .filter((p) => valueOf(p, attribution.get(p.id)) === 0)
    .slice(-LIMIT)
    .map(remember);

  const rejected = posts
    .filter((p) => p.status === "rejected")
    .sort(by((p) => p.decidedAt ?? p.createdAt, "desc"))
    .slice(0, LIMIT)
    .map((p) => ({ kind: p.kind, text: p.text, reason: p.error ?? "理由なし" }));

  const rewrites = posts
    .filter((p) => p.draftText && isRealRewrite(p.draftText, p.text))
    .sort(by((p) => p.decidedAt ?? p.createdAt, "desc"))
    .slice(0, 3)
    .map((p) => ({ kind: p.kind, before: p.draftText!, after: p.text }));

  const report = await latestReport(productId, conn);
  return { worked, didNotWork, rejected, rewrites, conclusions: report ? [...report.worked, ...report.failed.map((f) => `避ける: ${f}`)] : [] };
}

export function isEmptyMemory(memory: AgentMemory): boolean {
  return (
    memory.worked.length + memory.didNotWork.length + memory.rejected.length + memory.rewrites.length + memory.conclusions.length === 0
  );
}

/** The memory as a prompt section, filtered to the kind being written. */
export function renderMemory(memory: AgentMemory, kind: Post["kind"]): string {
  if (isEmptyMemory(memory)) return "";
  const oneLine = (text: string) => text.replace(/\s+/g, " ").slice(0, 160);
  const sections: string[] = ["# これまでに学んだこと（Agent Memory）"];

  if (kind === "post" && memory.worked.length) {
    sections.push("## 結果が良かった投稿（この方向を伸ばす）", ...memory.worked.map((p) => `- 「${oneLine(p.hook || p.text)}」→ ${p.outcome}`));
  }
  if (kind === "post" && memory.didNotWork.length) {
    sections.push("## 反応が無かった投稿（同じ型を繰り返さない）", ...memory.didNotWork.map((p) => `- 「${oneLine(p.hook || p.text)}」→ ${p.outcome}`));
  }
  if (kind === "post" && memory.conclusions.length) {
    sections.push("## 分析の結論", ...memory.conclusions.map((c) => `- ${c}`));
  }
  const rejected = memory.rejected.filter((r) => r.kind === kind);
  if (rejected.length) {
    sections.push("## 作者が見送った案と理由（同じことをしない）", ...rejected.map((r) => `- 「${oneLine(r.text)}」→ ${r.reason}`));
  }
  const rewrites = memory.rewrites.filter((r) => r.kind === kind);
  if (rewrites.length) {
    sections.push(
      "## 作者による書き直し（作者の好みとして最優先で真似る）",
      ...rewrites.map((r) => `- AIの案: 「${oneLine(r.before)}」\n  作者の直し: 「${oneLine(r.after)}」`),
    );
  }
  return sections.length > 1 ? sections.join("\n") : "";
}
