import { describe, expect, it } from "vitest";

import { createMemoryStore } from "@/db/store/memory";
import type { Database } from "@/db/client";

import { buildAgentMemory, isRealRewrite, renderMemory } from "./memory";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function post(conn: Database, overrides: Record<string, unknown>) {
  return conn.posts.insert({
    productId: "p1",
    kind: "post",
    postType: "educational",
    hook: "hook",
    body: "",
    cta: "",
    text: "text",
    rationale: "",
    ...overrides,
  });
}

describe("buildAgentMemory", () => {
  it("remembers what brought people, what did nothing, what was refused and how drafts were rewritten", async () => {
    const conn = createMemoryStore();
    await conn.products.insert({ id: "p1", userId: "u", url: "https://x.example/", name: "X", keyEventName: "signup" });
    const good = await post(conn, { hook: "問題から入る", status: "published", publishedAt: daysAgo(3) });
    await post(conn, { hook: "機能の紹介", status: "published", publishedAt: daysAgo(3) });
    // Published an hour ago: too soon to count as a failure.
    await post(conn, { hook: "今日の投稿", status: "published", publishedAt: new Date(Date.now() - 3_600_000) });
    await post(conn, { status: "rejected", text: "買ってください", error: "宣伝っぽい", decidedAt: daysAgo(1) });
    await post(conn, { kind: "reply", status: "approved", draftText: "ぜひ当社のツールを！", text: "自分はこうやって解決しました。", decidedAt: daysAgo(1) });
    await post(conn, { status: "approved", draftText: "同じ  文", text: "同じ 文", decidedAt: daysAgo(1) });
    await conn.events.insert({ productId: "p1", anonId: "a", sessionId: "s", name: "pageview", utm: { utm_content: good.id }, ts: daysAgo(2) });

    const memory = await buildAgentMemory("p1", conn);
    expect(memory.worked.map((p) => p.hook)).toEqual(["問題から入る"]);
    expect(memory.didNotWork.map((p) => p.hook)).toEqual(["機能の紹介"]);
    expect(memory.rejected).toEqual([{ kind: "post", text: "買ってください", reason: "宣伝っぽい" }]);
    expect(memory.rewrites).toHaveLength(1);

    const forPosts = renderMemory(memory, "post");
    expect(forPosts).toContain("問題から入る");
    expect(forPosts).toContain("宣伝っぽい");
    expect(forPosts).not.toContain("当社のツール");

    const forReplies = renderMemory(memory, "reply");
    expect(forReplies).toContain("当社のツール");
    expect(forReplies).not.toContain("問題から入る");
  });

  it("renders nothing when there is nothing to remember", async () => {
    const conn = createMemoryStore();
    await conn.products.insert({ id: "p1", userId: "u", url: "https://x.example/", name: "X" });
    expect(renderMemory(await buildAgentMemory("p1", conn), "post")).toBe("");
  });
});

describe("isRealRewrite", () => {
  it("ignores whitespace-only changes", () => {
    expect(isRealRewrite("a  b\n", "a b")).toBe(false);
    expect(isRealRewrite("a b", "a c")).toBe(true);
  });
});
