import { describe, expect, it } from "vitest";

import { EMPTY_USAGE, type LLMProvider, type StructuredCompletionRequest } from "@/core/llm/types";
import { createMemoryStore } from "@/db/store/memory";

import { planSteps, startGrowthRun, growthExecutor } from "./agent";
import { loadGrowthDashboard } from "./dashboard";
import { setGoal } from "./goals";
import { markPublished } from "./publish";
import { driveRun } from "./runs";
import { writePosts, type StepServices } from "./steps";
import type { ConversationSource } from "./sources/types";

/**
 * The Definition of Done (spec §38), end to end, against fakes for the model
 * and the outside world: URL → understanding → research → ICP → competitors
 * → strategy → opportunities → drafts → approve → publish → results →
 * the next proposal. Every step goes through the real job engine, the real
 * agents' parsing and the real persistence; only the model's answers and the
 * network are canned.
 */

type Answer = (req: StructuredCompletionRequest<unknown>) => unknown;

const ANSWERS: Record<string, Answer> = {
  product_knowledge: () => ({
    summary: "個人開発者のSaaSにユーザーを連れてくるツール。",
    problem: "作ったSaaSにユーザーが来ない。",
    solution: "見込み客の会話を見つけて、返信と投稿を用意する。",
    targetUser: "MVPを出したばかりの個人開発者",
    usp: ["URLを入れるだけ"],
    useCases: ["リリース直後の集客"],
    features: ["見込み客探索", "投稿案の作成"],
    pricing: "無料",
    marketingAngles: [{ name: "Time saving", description: "集客の時間を減らす" }],
  }),
  market_query_plan: () => ({ queries: ["ユーザーが来ない"], englishQueries: ["first users saas"] }),
  market_research: () => ({
    insights: [
      { kind: "pain", statement: "作っても誰にも使われない。", userPhrases: ["nobody uses my app"], sourceUrls: ["https://news.ycombinator.com/item?id=101"] },
      { kind: "trend", statement: "AIで作る個人開発が増えている。", userPhrases: [], sourceUrls: ["https://made-up.example/"] },
    ],
  }),
  competitor_candidates: () => ({ candidates: [{ name: "RivalApp", url: "rival.example", kind: "direct" }, { name: "Spreadsheets", url: "", kind: "alternative" }] }),
  competitor_analysis: () => ({
    competitors: [
      {
        name: "RivalApp",
        pricing: "$29/mo",
        positioning: "SNS予約投稿",
        targetAudience: "マーケター",
        features: ["予約投稿"],
        messaging: "Schedule everything",
        xHandle: "@rivalapp",
        contentStrategy: "機能紹介",
        strengths: ["安定"],
        weaknesses: ["見込み客は探さない"],
        differentiation: "こちらは会話を探す",
        sourceUrls: [],
      },
    ],
    gaps: [{ statement: "開発者向けに『最初の10人』を扱う競合がいない。", sourceUrls: [] }],
  }),
  icps: () => ({
    icps: [
      {
        name: "初めてMVPを出した個人開発者",
        role: "エンジニア",
        companySize: "1人",
        technicalLevel: "高い",
        problem: "ユーザーが来ない",
        pain: "時間をかけたのに誰も使わない",
        goal: "最初の100人",
        buyingTrigger: "リリース直後",
        currentAlternatives: ["X", "Product Hunt"],
        channels: ["X", "Hacker News"],
        keywords: ["first users", "saas"],
        xPhrases: ["ユーザーが来ない"],
      },
    ],
  }),
  marketing_strategy: () => ({
    positioning: "個人開発者の最初の100人を、会話から連れてくる。",
    messaging: ["作ったら、あとはAIが探す"],
    pillars: [
      { name: "Educational", share: 60, description: "集客のノウハウ", postTypes: ["educational"], topicIdeas: ["最初の10人の集め方"] },
      { name: "Build in public", share: 40, description: "開発の裏側", postTypes: ["build_in_public"], topicIdeas: ["今週の数字"] },
    ],
    channels: [{ name: "X", priority: 1, rationale: "ICPがいる" }],
    shortTerm: ["毎日1本投稿する"],
    midTerm: ["事例を作る"],
    rationale: "ICPはXとHNにいる。",
  }),
  opportunity_search_plan: () => ({ phrases: ["ユーザーが来ない"], englishQueries: ["first users"] }),
  opportunity_scores: () => ({
    results: [{ index: 0, relevance: 91, reasons: ["ICPと問題が一致", "解決策を探している"], intent: "seeking_solution", icpName: "初めてMVPを出した個人開発者", recommendedAction: "reply" }],
  }),
  x_posts: (req) => {
    const count = (req.user.match(/^\[\d+\]/gm) ?? []).length;
    return {
      posts: Array.from({ length: count }, (_, slot) => ({
        slot,
        hook: "作ったのに誰も使ってくれない？",
        body: "最初の10人は、同じ悩みを書いている人への返信から来ました。",
        cta: "",
        includeLink: slot === 0,
        rationale: "問題から入る",
      })),
    };
  },
  reply: () => ({ reply: "最初は、同じ問題を書いている人に直接返信するのが一番早かったです。", bridge: "自分もそのために小さなツールを作っています。", approach: "自分の経験を共有" }),
  performance_analysis: () => ({
    worked: ["問題から入るHookが反応を集めた"],
    failed: ["開発の裏側は訪問につながらなかった"],
    recommendation: "機能紹介より、具体的なHow-to投稿を増やす。",
    nextActions: ["How-toを週3本"],
  }),
};

function fakeProvider(calls: string[]): LLMProvider {
  return {
    name: "fake",
    model: "fake",
    health: async () => ({ ok: true, provider: "fake", model: "fake", detail: "" }),
    completeText: async () => ({ value: "", usage: EMPTY_USAGE, model: "fake" }),
    async completeStructured<T>(req: StructuredCompletionRequest<T>) {
      calls.push(req.schemaName);
      const answer = ANSWERS[req.schemaName];
      if (!answer) throw new Error(`No canned answer for ${req.schemaName}`);
      // Parsed through the agent's own schema, as a real provider's output is.
      return { value: req.schema.parse(answer(req as StructuredCompletionRequest<unknown>)), usage: EMPTY_USAGE, model: "fake" };
    },
  };
}

const hackerNews: ConversationSource = {
  name: "hackernews",
  available: () => true,
  search: async () => [
    {
      source: "hackernews",
      externalId: "101",
      url: "https://news.ycombinator.com/item?id=101",
      author: "maker",
      text: "I built a SaaS with AI but nobody uses it. Is there a tool to find my first users?",
      postedAt: new Date(),
    },
  ],
};

async function seedProduct() {
  const conn = createMemoryStore();
  const product = await conn.products.insert({ userId: "u1", url: "https://indie.example/", name: "IndieGrow", keyEventName: "signup" });
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
  return { conn, product };
}

describe("the growth loop", () => {
  it("goes from a registered URL to drafts, and from a published post to the next proposal", async () => {
    const { conn, product } = await seedProduct();
    const calls: string[] = [];
    const services: StepServices = {
      provider: fakeProvider(calls),
      web: null,
      hackerNews,
      sources: [hackerNews],
      fetchPage: async (url) =>
        url.includes("rival.example")
          ? { url, title: "RivalApp", text: "Schedule everything", meta: {}, sections: [], ctas: [], prices: ["$29"], links: [], manifestUrl: null }
          : null,
    };

    // Goal, then the first full run.
    await setGoal(product.id, { metric: "signups", target: 100, days: 30 }, conn);
    const { run } = await startGrowthRun(product.id, "u1", "initial", conn);
    const finished = await driveRun(run.id, growthExecutor(conn, services), 60_000, conn);

    expect(finished?.status).toBe("completed");
    expect(finished?.steps.map((s) => [s.kind, s.status])).toEqual([
      ["product", "completed"],
      ["market", "completed"],
      ["competitors", "completed"],
      ["icp", "completed"],
      ["strategy", "completed"],
      ["opportunities", "completed"],
      ["content", "completed"],
    ]);

    // Understanding and research were saved where the next agents read them.
    expect((await conn.productKnowledge.get(product.id))?.marketingAngles).toHaveLength(1);
    const insights = await conn.marketInsights.find();
    // Only the URL actually fetched counts as a source; the invented one does not.
    expect(insights.find((i) => i.kind === "pain")).toMatchObject({ grounded: true });
    expect(insights.find((i) => i.kind === "trend")).toMatchObject({ grounded: false, sources: [] });
    expect(insights.some((i) => i.kind === "gap")).toBe(true);
    const competitors = await conn.competitors.find();
    expect(competitors.find((c) => c.name === "RivalApp")).toMatchObject({ verified: true, xHandle: "@rivalapp" });

    // The strategy adds up, and the week is planned.
    const [strategy] = await conn.strategies.find();
    expect(strategy.pillars.reduce((s, p) => s + p.share, 0)).toBe(100);
    expect(strategy.weeklyPlan).toHaveLength(7);

    // An opportunity with its reasons, and a reply drafted for it.
    const [opportunity] = await conn.opportunities.find();
    expect(opportunity).toMatchObject({ relevance: 91, status: "drafted" });
    expect(opportunity.reasons.length).toBeGreaterThan(0);

    const posts = await conn.posts.find();
    const drafts = posts.filter((p) => p.kind === "post");
    const reply = posts.find((p) => p.kind === "reply")!;
    expect(drafts).toHaveLength(3); // three days drafted ahead
    // The answer comes first; at the default intensity the product is mentioned
    // only because this person is actively looking and the match is strong.
    expect(reply.text.startsWith("最初は、同じ問題を")).toBe(true);
    expect(reply.text).toContain("自分もそのために");
    const linked = drafts.find((p) => p.trackingUrl)!;
    expect(linked.trackingUrl).toContain(`utm_content=${linked.id}`);
    expect(linked.text).toContain(linked.trackingUrl!);

    // The dashboard explains itself before any results exist.
    const before = await loadGrowthDashboard(product.id, conn);
    expect(before.feed).toHaveLength(1);
    expect(before.recommendation.headline).toContain("解決策を探している人");

    // Approve → publish (by hand, as without X credentials) → people arrive from the link and sign up.
    for (const post of drafts) await markPublished(post.id, null, { database: conn });
    const tagged = { utm_campaign: "grape", utm_content: linked.id };
    await conn.events.insert({ productId: product.id, anonId: "a1", sessionId: "s1", name: "pageview", utm: tagged, ts: new Date() });
    await conn.events.insert({ productId: product.id, anonId: "a1", sessionId: "s1", name: "signup", ts: new Date(Date.now() + 1000) });

    // The next daily run reads the results and learns.
    expect(await planSteps(product.id, "daily", conn)).toEqual(["metrics", "performance", "opportunities", "content"]);
    const { run: daily } = await startGrowthRun(product.id, "u1", "daily", conn);
    const learned = await driveRun(daily.id, growthExecutor(conn, services), 60_000, conn);
    expect(learned?.steps.find((s) => s.kind === "metrics")?.status).toBe("skipped"); // no X credentials: site data only
    expect(learned?.steps.find((s) => s.kind === "performance")?.status).toBe("completed");

    const [report] = await conn.analyticsReports.find();
    expect(report.recommendation).toContain("How-to");
    expect(report.stats.reduce((s, t) => s + t.signups, 0)).toBe(1);

    const after = await loadGrowthDashboard(product.id, conn);
    expect(after.progress).toMatchObject({ current: 1, target: 100 });
    expect(after.week).toMatchObject({ posts: 3, visits: 1, signups: 1 });
    expect(after.recommendation).toMatchObject({ source: "analysis" });
    expect(after.activity.length).toBeGreaterThan(5);
  });

  it("writes a one-off post from a conversation without taking a day in the plan", async () => {
    const { conn, product } = await seedProduct();
    await conn.productKnowledge.set(product.id, {
      productId: product.id,
      summary: "s",
      problem: "p",
      solution: "s",
      targetUser: "t",
      usp: [],
      useCases: [],
      features: [],
      pricing: "",
      marketingAngles: [],
      contextVersion: 1,
    });
    const knowledge = (await conn.productKnowledge.get(product.id))!;
    const [post] = await writePosts(
      product,
      knowledge,
      [{ day: 0, pillar: "Problem awareness", postType: "problem_awareness", topic: "t", date: "2026-09-26" }],
      { provider: fakeProvider([]), system: "", language: "ja" },
      conn,
      { plan: false },
    );
    expect(post).toMatchObject({ kind: "post", status: "draft", plannedFor: null });
    expect(post.trackingUrl).toContain(`utm_content=${post.id}`);
  });
});
