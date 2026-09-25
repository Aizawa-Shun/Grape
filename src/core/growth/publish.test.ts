import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStore } from "@/db/store/memory";
import type { Database } from "@/db/client";

let dryRun = true;
vi.mock("@/core/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/settings")>();
  return { ...actual, currentSettings: () => ({ ...actual.currentSettings(), GRAPE_ACTION_DRY_RUN: dryRun }) };
});

const { approvePost, markPublished, rejectPost } = await import("./publish");

const noon = new Date("2026-09-01T03:00:00Z");

async function seed(conn: Database, overrides: Record<string, unknown> = {}) {
  return conn.posts.insert({
    productId: "p1",
    kind: "post",
    postType: "educational",
    hook: "h",
    body: "b",
    cta: "",
    text: "個人開発のSaaSで最初の10人を集めた方法",
    rationale: "r",
    ...overrides,
  });
}

describe("approvePost", () => {
  let conn: Database;
  beforeEach(() => {
    conn = createMemoryStore();
    dryRun = true;
  });

  it("in practice mode, records the approval and sends nothing", async () => {
    const post = await seed(conn);
    const sender = vi.fn();
    const approved = await approvePost(post.id, { database: conn, now: noon, sender });
    expect(approved).toMatchObject({ status: "approved", dryRun: true });
    expect(sender).not.toHaveBeenCalled();
  });

  it("sends through X when practice mode is off, as a reply when it is one", async () => {
    dryRun = false;
    const opportunity = await conn.opportunities.insert({
      productId: "p1",
      source: "x",
      externalId: "1999",
      url: "https://x.com/a/status/1999",
      author: "@a",
      text: "t",
      relevance: 90,
      reasons: ["r"],
      intent: "seeking_solution",
      recommendedAction: "reply",
    });
    const post = await seed(conn, { kind: "reply", opportunityId: opportunity.id, replyToExternalId: "1999" });
    const sender = vi.fn(async () => ({ id: "2000", externalUrl: "https://x.com/i/status/2000" }));
    const published = await approvePost(post.id, { database: conn, now: noon, sender });
    expect(sender).toHaveBeenCalledWith(post.text, "1999");
    expect(published).toMatchObject({ status: "published", externalId: "2000" });
    expect((await conn.opportunities.get(opportunity.id))!.status).toBe("replied");
  });

  it("marks a send that failed as failed, and lets it be tried again", async () => {
    dryRun = false;
    const post = await seed(conn);
    await expect(approvePost(post.id, { database: conn, now: noon, sender: async () => Promise.reject(new Error("503")) })).rejects.toThrow();
    expect((await conn.posts.get(post.id))!.status).toBe("failed");
    const retried = await approvePost(post.id, { database: conn, now: noon, sender: async () => ({ id: "1", externalUrl: "u" }) });
    expect(retried.status).toBe("published");
  });

  it("holds a person to the daily limit", async () => {
    await conn.growthPolicies.set("p1", {
      productId: "p1",
      approvalMode: "assisted",
      maxPostsPerDay: 1,
      maxRepliesPerDay: 5,
      minRelevance: 70,
      blockKeywords: [],
      competitorMentions: "neutral",
      promotionalIntensity: 2,
      quietHoursStart: 23,
      quietHoursEnd: 7,
    });
    await approvePost((await seed(conn)).id, { database: conn, now: noon });
    await expect(approvePost((await seed(conn)).id, { database: conn, now: noon })).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
  });

  it("refuses a post over X's weighted limit", async () => {
    const post = await seed(conn, { text: "あ".repeat(141) });
    await expect(approvePost(post.id, { database: conn, now: noon })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("leaves a reply to a forum for the person to post, then records it", async () => {
    dryRun = false;
    const opportunity = await conn.opportunities.insert({
      productId: "p1",
      source: "hackernews",
      externalId: "42",
      url: "https://news.ycombinator.com/item?id=42",
      author: "pg",
      text: "t",
      relevance: 90,
      reasons: ["r"],
      intent: "question",
      recommendedAction: "reply",
    });
    const post = await seed(conn, { kind: "reply", opportunityId: opportunity.id });
    const sender = vi.fn();
    expect(await approvePost(post.id, { database: conn, now: noon, sender })).toMatchObject({ status: "approved", dryRun: false });
    expect(sender).not.toHaveBeenCalled();
    expect(await markPublished(post.id, null, { database: conn, now: noon })).toMatchObject({ status: "published" });
  });
});

describe("rejectPost", () => {
  it("keeps the reason, for the next drafts to learn from", async () => {
    const conn = createMemoryStore();
    const post = await seed(conn);
    const rejected = await rejectPost(post.id, "宣伝っぽい", { database: conn });
    expect(rejected).toMatchObject({ status: "rejected", error: "宣伝っぽい" });
  });
});

describe("approvePost and Agent Memory", () => {
  it("keeps the agent's original words when a person rewrites them", async () => {
    const conn = createMemoryStore();
    dryRun = true;
    const post = await seed(conn);
    const approved = await approvePost(post.id, { database: conn, now: noon, text: "自分の言葉で書き直した" });
    expect(approved).toMatchObject({ text: "自分の言葉で書き直した", draftText: post.text });
  });
});
