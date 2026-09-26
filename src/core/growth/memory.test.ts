import { describe, expect, it } from "vitest";

import { createMemoryStore } from "@/db/store/memory";
import type { Database } from "@/db/client";

import { buildAgentMemory, isRealRewrite, renderMemory } from "./memory";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function post(conn: Database, overrides: Record<string, unknown>) {
  return conn.posts.insert({ productId: "p1", kind: "post", postType: "educational", hook: "h", body: "", cta: "", text: "text", rationale: "", ...overrides });
}

async function learning(conn: Database, direction: "works" | "fails" | "unclear", statement: string, status: "active" | "superseded" = "active") {
  return conn.learnings.insert({
    productId: "p1",
    kind: "pain",
    direction,
    statement,
    explanation: "e",
    confidence: "medium",
    evidence: { posts: 5, impressions: 1000, engagements: 20, visits: 10, signups: 1, lift: 0.4 },
    status,
  });
}

describe("buildAgentMemory", () => {
  it("remembers decided learnings, refusals and rewrites — not unclear or superseded learnings", async () => {
    const conn = createMemoryStore();
    await learning(conn, "works", "「マーケが苦手」の痛みが効く");
    await learning(conn, "unclear", "形式はまだ不明");
    await learning(conn, "fails", "古い学び", "superseded");
    await post(conn, { status: "rejected", text: "買ってください", error: "宣伝っぽい", decidedAt: daysAgo(1) });
    await post(conn, { kind: "reply", status: "approved", draftText: "ぜひ当社のツールを！", text: "自分はこうやって解決しました。", decidedAt: daysAgo(1) });
    await post(conn, { status: "approved", draftText: "同じ  文", text: "同じ 文", decidedAt: daysAgo(1) });

    const memory = await buildAgentMemory("p1", conn);
    expect(memory.learnings.map((l) => l.statement)).toEqual(["「マーケが苦手」の痛みが効く"]);
    expect(memory.rejected).toEqual([{ kind: "post", text: "買ってください", reason: "宣伝っぽい" }]);
    expect(memory.rewrites).toHaveLength(1);

    const forPosts = renderMemory(memory, "post");
    expect(forPosts).toContain("マーケが苦手");
    expect(forPosts).toContain("宣伝っぽい");
    expect(forPosts).not.toContain("当社のツール");
    expect(renderMemory(memory, "reply")).toContain("当社のツール");
  });

  it("renders nothing when there is nothing to remember", async () => {
    expect(renderMemory(await buildAgentMemory("p1", createMemoryStore()), "post")).toBe("");
  });
});

describe("isRealRewrite", () => {
  it("ignores whitespace-only changes", () => {
    expect(isRealRewrite("a  b\n", "a b")).toBe(false);
    expect(isRealRewrite("a b", "a c")).toBe(true);
  });
});
