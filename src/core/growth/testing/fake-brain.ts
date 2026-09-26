import type { LLMProvider, StructuredCompletionRequest } from "@/core/llm/types";
import { EMPTY_USAGE } from "@/core/llm/types";

import type { StepServices } from "../steps";
import type { ConversationSource } from "../sources/types";

/**
 * A fake model and a fake outside world for the growth loop: canned answers
 * per output schema, parsed through the agent's own schema as a real
 * provider's are. Shared by the end-to-end test and by the script that seeds
 * a local emulator so the screens can be looked at without an API key.
 */

type Answer = (req: StructuredCompletionRequest<unknown>) => unknown;

let ideaCounter = 0;

const ANSWERS: Record<string, Answer> = {
  product_knowledge: () => ({
    what: { text: "個人開発者のSaaSにユーザーを連れてくるツール", status: "known", quote: "Grow your indie SaaS", url: "https://indie.example/" },
    targetUsers: [{ text: "MVPを出したばかりの個人開発者", status: "assumption", quote: "", url: "" }],
    problems: [{ text: "作ったSaaSにユーザーが来ない", status: "known", quote: "Built it, but nobody came?", url: "https://indie.example/" }],
    benefits: [],
    features: [{ text: "見込み客探索", status: "known", quote: "Finds people asking for tools like yours", url: "https://indie.example/" }],
    differentiators: [
      { text: "成果が出たときだけ課金", status: "known", quote: "Only pay when you get users", url: "https://indie.example/pricing" },
      // Claimed as known, but the quote is not on any page: code downgrades it.
      { text: "業界最速", status: "known", quote: "The fastest in the industry", url: "https://indie.example/" },
    ],
    useCases: [],
    pricing: [],
    proof: [{ text: "120人の個人開発者が利用", status: "known", quote: "Used by 120 indie makers", url: "https://indie.example/" }],
    questions: [{ topic: "pricing", question: "有料プランはいくらですか？", whyItMatters: "「無料」と言ってよいかが決まる", guess: "" }],
  }),
  market_query_plan: () => ({ queries: ["ユーザーが来ない"], englishQueries: ["first users saas"] }),
  market_research: () => ({
    insights: [
      { kind: "pain", statement: "作っても誰にも使われない。", userPhrases: ["nobody uses my app"], sourceUrls: ["https://news.ycombinator.com/item?id=101"] },
      { kind: "phrase", statement: "「最初のユーザー」という言い方が多い。", userPhrases: ["first 10 users"], sourceUrls: ["https://news.ycombinator.com/item?id=101"] },
      { kind: "community", statement: "Indie Hackersに集まっている。", userPhrases: [], sourceUrls: ["https://made-up.example/"] },
    ],
  }),
  competitor_candidates: () => ({ candidates: [{ name: "RivalApp", url: "rival.example", kind: "direct" }] }),
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
  audience_segments: () => ({
    segments: [
      {
        name: "初めてMVPを出した個人開発者",
        role: "エンジニア",
        companySize: "1人",
        technicalLevel: "高い",
        situation: "リリースした翌週",
        problem: "ユーザーが来ない",
        pain: "時間をかけたのに誰も使わない",
        motivation: "副業を事業にしたい",
        currentSolutions: ["Xで告知", "Product Hunt"],
        fitReason: "会話から見込み客を探せる",
        channels: ["X", "Hacker News"],
        keywords: ["first users", "saas"],
        xPhrases: ["ユーザーが来ない"],
        evidence: [0, 1],
      },
    ],
  }),
  positioning: () => ({
    oneLiner: "個人開発者の最初の100人を、会話から連れてくる",
    forWhom: "MVPを出したばかりの個人開発者",
    problem: "作ったのにユーザーが来ない",
    product: "見込み客の会話を見つけて返信と投稿を用意するツール",
    alternatives: ["RivalApp", "手作業の告知"],
    becauseFacts: [0, 1, 2],
  }),
  marketing_strategy: () => ({
    coreMessage: "作ったら、あとはGrapeが探す",
    supportingMessages: ["最初の10人は会話から来る"],
    pillars: [
      { name: "集客のノウハウ", share: 60, description: "d", postTypes: ["educational"] },
      { name: "開発の裏側", share: 40, description: "d", postTypes: ["build_in_public"] },
    ],
    channels: [
      { name: "Reddit", role: "focus", rationale: "コミュニティ", startWhen: "" },
      { name: "SEO", role: "later", rationale: "長期", startWhen: "登録10件" },
    ],
    acquisition: ["毎日1本投稿する"],
    conversion: ["LPに事例を置く"],
    retentionReferral: ["紹介特典"],
    rationale: "セグメントはXとHNにいる。",
  }),
  experiment_hypotheses: (req) => ({
    hypotheses: req.user.includes("結論が出た仮説")
      ? [
          // Repeats a concluded claim: code drops it.
          { statement: "「AIで作れる」という訴求は反応を集める", dimension: "message", subject: "AIで作れる", basis: "再", expected: "反応率が高い", basisInsights: [1] },
          { statement: "「マーケが苦手」の痛みは、失敗談の形式で書くとさらに訪問につながる", dimension: "format", subject: "失敗談", basis: "学び", expected: "表示→訪問が高い", basisInsights: [0] },
          { statement: "「マーケが苦手」の痛みは、手順の形式で書くと反応を集める", dimension: "format", subject: "手順", basis: "学び", expected: "反応率が高い", basisInsights: [0] },
        ]
      : [
      {
        statement: "「マーケが苦手」という痛みは、「AIで作れる」という訴求より訪問につながる",
        dimension: "pain",
        subject: "マーケが苦手",
        basis: "調査[0]",
        expected: "表示→訪問が高い",
        basisInsights: [0],
      },
      {
        statement: "「AIで作れる」という訴求は反応を集める",
        dimension: "message",
        subject: "AIで作れる",
        basis: "調査[1]",
        expected: "反応率が高い",
        basisInsights: [1],
      },
        ],
  }),
  post_ideas: (req) => {
    const wants = [...req.user.matchAll(/^\[(\d+)\][\s\S]*?本数: (\d+)/gm)].map((m) => ({ index: Number(m[1]), n: Number(m[2]) }));
    return {
      ideas: wants.flatMap(({ index, n }) =>
        Array.from({ length: n }, () => ({ hypothesisIndex: index, pillar: "集客のノウハウ", postType: "educational", topic: `ネタ${++ideaCounter}` })),
      ),
    };
  },
  x_posts: (req) => {
    const count = (req.user.match(/^\[\d+\]/gm) ?? []).length;
    return {
      posts: Array.from({ length: count }, (_, slot) => ({
        slot,
        hook: "作ったのに誰も使ってくれない？",
        body: "最初の10人は、同じ悩みを書いている人への返信から来ました。",
        cta: "",
        includeLink: true,
        assetNeeded: "",
        rationale: "問題から入る",
      })),
    };
  },
  opportunity_search_plan: () => ({ phrases: ["ユーザーが来ない"], englishQueries: ["first users"] }),
  opportunity_scores: () => ({
    results: [{ index: 0, relevance: 91, reasons: ["セグメントと問題が一致", "解決策を探している"], intent: "seeking_solution", segmentName: "初めてMVPを出した個人開発者", recommendedAction: "reply" }],
  }),
  reply: () => ({ reply: "最初は、同じ問題を書いている人に直接返信するのが一番早かったです。", bridge: "自分もそのためのツールを作っています。", approach: "経験を共有" }),
  weekly_review: () => ({ headline: "痛みから入った投稿だけが訪問を生んだ", why: ["訴求の違いで訪問率が3倍違う"], nextActions: ["痛みの投稿を増やす"] }),
  learning: (req) => ({
    statement: req.user.includes("マーケが苦手") ? "「マーケが苦手」という痛みの方が、訪問につながる" : "「AIで作れる」という訴求は訪問につながらない",
    explanation: "読者が自分の状況を重ねやすい",
    kind: "pain",
  }),
  strategy_revision: () => ({
    coreMessage: "マーケが苦手でも、最初の100人は来る",
    supportingMessages: ["最初の10人は会話から来る"],
    pillars: [
      { name: "集客のノウハウ", share: 80, description: "d", postTypes: ["educational"] },
      { name: "開発の裏側", share: 20, description: "d", postTypes: ["build_in_public"] },
    ],
    acquisition: ["痛みから入る投稿を毎日"],
    changes: [
      { what: "中心メッセージを「マーケが苦手」の痛みに寄せた", because: "学び[0]で訪問率が3倍", learningIndex: 0 },
      { what: "思いつきの変更", because: "根拠なし", learningIndex: 42 },
    ],
    rationale: "痛みの訴求が効いた。",
  }),
};

export function fakeProvider(calls: string[]): LLMProvider {
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

export function fakeServices(calls: string[] = []): StepServices {
  return {
    provider: fakeProvider(calls),
    web: null,
    hackerNews,
    sources: [hackerNews],
    suggest: { suggest: async () => ["first users saas", "first users for my saas", "how to get first users saas"] },
    fetchPage: async (url) =>
      url.includes("rival.example")
        ? { url, title: "RivalApp", text: "Schedule everything", meta: {}, sections: [], ctas: [], prices: ["$29"], links: [], manifestUrl: null }
        : null,
  };
}
