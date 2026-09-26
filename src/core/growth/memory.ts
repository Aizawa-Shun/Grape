import { db, type Database } from "@/db/client";
import type { Learning, Post } from "@/db/schema";
import { by } from "@/db/sort";

import { activeLearnings } from "./latest";

/**
 * What every writer is shown before it writes (spec §9): the marketing
 * knowledge this product has built up, and the owner's taste.
 *
 * Two sources, both earned rather than inferred. Learnings — what experiments
 * showed works and fails for this product, with why. And the owner's own
 * hand: drafts they turned down (with their reason), and how they rewrote
 * drafts before approving them — the clearest statement of their preferences
 * there is. Selected and ranked in code; the writers only read it.
 */

export interface Rewrite {
  kind: Post["kind"];
  before: string;
  after: string;
}

export interface AgentMemory {
  learnings: Pick<Learning, "direction" | "statement" | "explanation">[];
  rejected: { kind: Post["kind"]; text: string; reason: string }[];
  rewrites: Rewrite[];
}

const LIMIT = 4;

/** A rewrite worth remembering changed more than whitespace. */
export function isRealRewrite(before: string, after: string): boolean {
  const norm = (text: string) => text.replace(/\s+/g, " ").trim();
  return norm(before) !== norm(after);
}

export async function buildAgentMemory(productId: string, conn: Database = db): Promise<AgentMemory> {
  const [posts, learnings] = await Promise.all([conn.posts.find({ where: [["productId", "==", productId]] }), activeLearnings(productId, conn)]);

  const rejected = posts
    .filter((p) => p.status === "rejected")
    .sort(by((p) => p.decidedAt ?? p.createdAt, "desc"))
    .slice(0, LIMIT)
    .map((p) => ({ kind: p.kind, text: p.text || p.topic || "", reason: p.error ?? "理由なし" }));

  const rewrites = posts
    .filter((p) => p.draftText && isRealRewrite(p.draftText, p.text))
    .sort(by((p) => p.decidedAt ?? p.createdAt, "desc"))
    .slice(0, 3)
    .map((p) => ({ kind: p.kind, before: p.draftText!, after: p.text }));

  return {
    learnings: learnings.filter((l) => l.direction !== "unclear").slice(0, 8),
    rejected,
    rewrites,
  };
}

export function isEmptyMemory(memory: AgentMemory): boolean {
  return memory.learnings.length + memory.rejected.length + memory.rewrites.length === 0;
}

/** The memory as a prompt section, filtered to the kind being written. */
export function renderMemory(memory: AgentMemory, kind: Post["kind"]): string {
  if (isEmptyMemory(memory)) return "";
  const oneLine = (text: string) => text.replace(/\s+/g, " ").slice(0, 160);
  const sections: string[] = ["# これまでに学んだこと"];

  if (kind === "post" && memory.learnings.length) {
    sections.push(
      "## この製品で、結果から分かったこと",
      ...memory.learnings.map((l) => `- [${l.direction === "works" ? "効いた" : "効かなかった"}] ${l.statement}`),
    );
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
