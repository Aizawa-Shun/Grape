import { describe, expect, it } from "vitest";

import type { Database } from "@/db/client";
import { createMemoryStore } from "@/db/store/memory";

import { growthExecutor, planSteps, startGrowthRun } from "./agent";
import { loadBrainView } from "./dashboard";
import { setGoal } from "./goals";
import { driveRun } from "./runs";
import { fakeServices } from "./testing/fake-brain";

/**
 * The MVP loop (spec §10), end to end, against fakes for the model and the
 * outside world only:
 *
 *   URL → product → market → audience → positioning → strategy → hypotheses
 *   → ideas → drafts → [published] → measurement → verdict → learning
 *   → strategy revision → the next hypotheses
 *
 * Every step goes through the real job engine, the real agents' parsing and
 * the real code-side decisions (fact verification, confidence, focus, the
 * verdict); only what the model says and what the network returns is canned.
 */

async function seedProduct() {
  const conn = createMemoryStore();
  const product = await conn.products.insert({ userId: "u1", url: "https://indie.example/", name: "IndieGrow", keyEventName: null });
  await conn.productContexts.insert({
    productId: product.id,
    version: 1,
    what: "個人開発者の集客を助けるSaaS",
    who: "個人開発者",
    why: "ユーザーが来ない",
    how: "URLを入れる",
    sourcePages: [product.url],
    primaryLanguage: "ja",
    editedByHuman: true,
  });
  await conn.crawlPages.insert({
    productId: product.id,
    url: "https://indie.example/",
    status: 200,
    title: "IndieGrow",
    text: "Grow your indie SaaS. Built it, but nobody came? Finds people asking for tools like yours. Used by 120 indie makers.",
  });
  await conn.crawlPages.insert({ productId: product.id, url: "https://indie.example/pricing", status: 200, title: "Pricing", text: "Only pay when you get users." });
  return { conn, product };
}

/** Publishes every written or planned post of a hypothesis, with the reach and visitors given. */
async function publishFor(conn: Database, productId: string, hypothesisId: string, impressions: number, visitorsPerPost: number) {
  const posts = (await conn.posts.find({ where: [["productId", "==", productId]] })).filter((p) => p.hypothesisId === hypothesisId && p.status !== "rejected");
  const publishedAt = new Date(Date.now() - 3 * 86_400_000);
  for (const post of posts) {
    await conn.posts.update(post.id, {
      status: "published",
      text: post.text || `${post.topic}`,
      publishedAt,
      decidedAt: publishedAt,
      metrics: { impressions, likes: 5, replies: 0, reposts: 0, quotes: 0, bookmarks: 0, profileVisits: null, linkClicks: null, source: "manual" },
    });
    for (let v = 0; v < visitorsPerPost; v++) {
      await conn.events.insert({
        productId,
        anonId: `${post.id}-${v}`,
        sessionId: `${post.id}-${v}`,
        name: "pageview",
        utm: { utm_campaign: "grape", utm_content: post.id },
        ts: new Date(publishedAt.getTime() + 60_000),
      });
    }
  }
  return posts.length;
}

describe("the Marketing Brain loop", () => {
  it("understands, decides, executes, measures, learns — and changes its strategy because of what it learned", async () => {
    const { conn, product } = await seedProduct();
    const calls: string[] = [];

    await setGoal(product.id, { metric: "signups", target: 100, days: 30 }, conn);
    const { run } = await startGrowthRun(product.id, "u1", "initial", conn);
    const first = await driveRun(run.id, growthExecutor(conn, fakeServices(calls)), 60_000, conn);

    expect(first?.status).toBe("completed");
    expect(first?.steps.map((s) => [s.kind, s.status])).toEqual([
      ["product", "completed"],
      ["market", "completed"],
      ["competitors", "completed"],
      ["audience", "completed"],
      ["positioning", "completed"],
      ["strategy", "completed"],
      ["experiments", "completed"],
      ["ideas", "completed"],
      ["content", "completed"],
      ["opportunities", "completed"],
    ]);

    // Product: known only where the quote is really on the page; the rest are assumptions or questions.
    const knowledge = (await conn.productKnowledge.get(product.id))!;
    expect(knowledge.what).toMatchObject({ status: "known", basis: "site" });
    expect(knowledge.differentiators.map((f) => [f.text, f.status])).toEqual([
      ["成果が出たときだけ課金", "known"],
      ["業界最速", "assumption"],
    ]);
    expect(knowledge.differentiators[0].evidence[0].url).toBe("https://indie.example/pricing");
    expect(knowledge.questions.some((q) => q.topic === "pricing")).toBe(true);

    // Market: customer language, including what the search box says — grounded by construction.
    const insights = await conn.marketInsights.find();
    expect(insights.find((i) => i.kind === "search_demand")).toMatchObject({ grounded: true });
    expect(insights.find((i) => i.kind === "community")).toMatchObject({ grounded: false });

    // Audience & positioning: confidence counted from real sources; reasons carry their status.
    const [segment] = await conn.segments.find();
    expect(segment).toMatchObject({ confidence: "medium", status: "hypothesis" });
    const [positioning] = await conn.positionings.find();
    expect(positioning.because.map((b) => b.status)).toEqual(["known", "assumption", "known"]);

    // Strategy: X is the one focus, whatever the model proposed.
    const [strategy] = await conn.strategies.find();
    expect(strategy.channels.filter((c) => c.role === "focus").map((c) => c.name)).toEqual(["X"]);
    expect(strategy.positioning.oneLiner).toBe(positioning.oneLiner);

    // Hypotheses, and a week of ideas that alternate between them.
    const hypotheses = await conn.hypotheses.find();
    expect(hypotheses).toHaveLength(2);
    const ideasAndDrafts = (await conn.posts.find()).filter((p) => p.kind === "post");
    expect(ideasAndDrafts).toHaveLength(7);
    expect(new Set(ideasAndDrafts.map((p) => p.plannedFor)).size).toBe(7);
    const drafted = ideasAndDrafts.filter((p) => p.status === "draft");
    expect(drafted.length).toBeGreaterThanOrEqual(2);
    expect(drafted.every((p) => p.trackingUrl?.includes(`utm_content=${p.id}`))).toBe(true);

    // The home screen reads as a marketer's briefing, and says what to do next.
    const brain = await loadBrainView(product.id, conn);
    expect(brain.recommendation.headline).toContain("承認を待っている投稿");
    expect(brain.product?.tally.known).toBeGreaterThan(0);
    expect(brain.feed).toHaveLength(1);

    // ── Results come in: the "pain" posts bring three times the visitors per impression.
    const pain = hypotheses.find((h) => h.subject === "マーケが苦手")!;
    const message = hypotheses.find((h) => h.subject === "AIで作れる")!;
    // Top each hypothesis up to three published posts, as a week of publishing would.
    for (const h of [pain, message]) {
      const own = (await conn.posts.find()).filter((p) => p.hypothesisId === h.id);
      for (let i = own.length; i < 3; i++) {
        await conn.posts.insert({ productId: product.id, kind: "post", postType: "educational", hypothesisId: h.id, topic: `追加${h.subject}${i}`, hook: "", body: "", cta: "", text: `追加${i}`, rationale: "" });
      }
    }
    expect(await publishFor(conn, product.id, pain.id, 100, 3)).toBeGreaterThanOrEqual(3);
    expect(await publishFor(conn, product.id, message.id, 100, 1)).toBeGreaterThanOrEqual(3);

    // ── The next day: measure → learn → revise → new experiments.
    expect(await planSteps(product.id, "daily", conn)).toEqual([
      "metrics",
      "measure",
      "learn",
      "revise",
      "watch",
      "experiments",
      "ideas",
      "content",
      "opportunities",
    ]);
    const { run: daily } = await startGrowthRun(product.id, "u1", "daily", conn);
    const second = await driveRun(daily.id, growthExecutor(conn, fakeServices(calls)), 60_000, conn);
    const step = (kind: string) => second?.steps.find((s) => s.kind === kind);
    expect(step("metrics")?.status).toBe("skipped"); // no X credentials: the numbers came in by hand
    expect(step("measure")?.status).toBe("completed");

    // The verdicts were reached in code, from the numbers.
    const judged = await conn.hypotheses.find();
    expect(judged.find((h) => h.id === pain.id)).toMatchObject({ status: "supported", learned: true });
    expect(judged.find((h) => h.id === message.id)).toMatchObject({ status: "refuted", learned: true });
    expect(judged.find((h) => h.id === pain.id)?.result?.lift).toBe(2);

    // Learnings: product-specific marketing knowledge, with the evidence behind it.
    const learnings = await conn.learnings.find();
    expect(learnings.map((l) => l.direction).sort()).toEqual(["fails", "works"]);
    expect(learnings.find((l) => l.direction === "works")?.evidence.lift).toBe(2);

    // The strategy changed because of a learning — and only the supported change was kept.
    const versions = (await conn.strategies.find()).sort((a, b) => b.version - a.version);
    expect(versions[0]).toMatchObject({ version: 2, origin: "revision", coreMessage: "マーケが苦手でも、最初の100人は来る" });
    expect(versions[0].changes).toEqual([{ what: "中心メッセージを「マーケが苦手」の痛みに寄せた", because: "学び[0]で訪問率が3倍" }]);
    expect(versions[0].channels).toEqual(versions[1].channels);

    // The week's review has the funnel, with signups "not measured" rather than zero.
    const [report] = await conn.analyticsReports.find();
    expect(report.funnel).toMatchObject({ impressions: expect.any(Number), signups: null });

    // And the loop goes on: new hypotheses, written with the learnings in hand.
    const next = (await conn.hypotheses.find()).filter((h) => h.status === "testing");
    expect(next.map((h) => h.subject).sort()).toEqual(["失敗談", "手順"].sort());

    const after = await loadBrainView(product.id, conn);
    expect(after.learnings.length).toBe(2);
    expect(after.strategy?.version).toBe(2);
  });
});
