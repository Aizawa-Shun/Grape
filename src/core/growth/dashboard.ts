import { db, type Database } from "@/db/client";
import type {
  AgentAction,
  AnalyticsReport,
  Fact,
  GrowthGoal,
  GrowthPolicy,
  GrowthRun,
  Hypothesis,
  Learning,
  MarketInsight,
  MarketingStrategy,
  Opportunity,
  OpenQuestion,
  Positioning,
  Post,
  Segment,
} from "@/db/schema";
import { by } from "@/db/sort";

import { recentActions } from "./activity";
import { attributePosts, eventConfigOf, eventsSince, goalProgress, type EventConfig, type GoalProgress } from "./attribution";
import { LIST_TOPICS, tally, type KnowledgeTally } from "./facts";
import {
  activeGoal,
  activeLearnings,
  activeStrategy,
  allHypotheses,
  latestInsights,
  latestPositioning,
  latestReport,
  latestSegments,
} from "./latest";
import { buildFunnel } from "./measurement";
import { getPolicy } from "./policy";
import { activeRun } from "./runs";
import { recentMoves } from "./watch";

/**
 * The Brain, as the home screen reads it (spec §11): not a list of tools but
 * what Grape currently thinks about this product — product, market, audience,
 * strategy, what to do next, and what it has learned. Everything is gathered
 * and counted here; the page renders and decides nothing.
 */

const WEEK_MS = 7 * 86_400_000;

export interface Recommendation {
  headline: string;
  why: string;
  action: { label: string; href: string } | null;
}

export interface BrainView {
  goal: GrowthGoal | null;
  progress: GoalProgress | null;
  product: {
    what: Fact | null;
    highlights: Fact[];
    tally: KnowledgeTally;
    questions: OpenQuestion[];
  } | null;
  market: {
    pains: MarketInsight[];
    phrases: string[];
    communities: MarketInsight[];
    moves: MarketInsight[];
  };
  audience: Segment[];
  positioning: Positioning | null;
  strategy: MarketingStrategy | null;
  experiments: Hypothesis[];
  learnings: Learning[];
  report: AnalyticsReport | null;
  week: ReturnType<typeof buildFunnel>;
  events: EventConfig;
  recommendation: Recommendation;
  approvals: Post[];
  upcoming: Post[];
  feed: Opportunity[];
  activity: AgentAction[];
  run: GrowthRun | null;
  policy: GrowthPolicy;
  hasBrain: boolean;
}

export async function loadBrainView(productId: string, conn: Database = db, now: Date = new Date()): Promise<BrainView> {
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const [product, knowledge, goal, policy, posts, opportunities, insights, segments, positioning, strategy, hypotheses, learnings, report, activity, run, moves] =
    await Promise.all([
      conn.products.get(productId),
      conn.productKnowledge.get(productId),
      activeGoal(productId, conn),
      getPolicy(productId, conn),
      conn.posts.find({ where: [["productId", "==", productId]] }),
      conn.opportunities.find({ where: [["productId", "==", productId]] }),
      latestInsights(productId, conn),
      latestSegments(productId, conn),
      latestPositioning(productId, conn),
      activeStrategy(productId, conn),
      allHypotheses(productId, conn),
      activeLearnings(productId, conn),
      latestReport(productId, conn),
      recentActions(productId, 12, conn),
      activeRun(productId, conn),
      recentMoves(productId, 14, conn, now),
    ]);

  const events = eventConfigOf(product);
  const progress = goal ? await goalProgress(goal, conn, now) : null;

  const recentPublished = posts.filter((p) => p.kind === "post" && p.status === "published" && p.publishedAt && p.publishedAt >= weekAgo);
  const weekEvents = recentPublished.length ? await eventsSince(productId, weekAgo, conn) : [];
  const week = buildFunnel(recentPublished, attributePosts(weekEvents, recentPublished.map((p) => p.id), events), events);

  const approvals = posts
    .filter((p) => p.status === "draft" || p.status === "failed" || (p.status === "approved" && !p.publishedAt))
    .sort(by((p) => p.plannedFor ?? p.createdAt.toISOString()));
  const upcoming = posts
    .filter((p) => p.status === "idea" && p.plannedFor)
    .sort(by((p) => p.plannedFor ?? ""))
    .slice(0, 7);
  const open = opportunities.filter((o) => o.status === "new");
  const feed = open.filter((o) => o.relevance >= policy.minRelevance).sort(by((o) => o.relevance, "desc")).slice(0, 5);

  const highlights = knowledge
    ? [...knowledge.problems, ...knowledge.differentiators, ...knowledge.proof].filter((f) => f.status === "known").slice(0, 4)
    : [];

  const publishedEver = posts.filter((p) => p.kind === "post" && p.status === "published");
  const unmeasured = publishedEver.filter((p) => !p.metrics && p.publishedAt && now.getTime() - p.publishedAt.getTime() > 86_400_000).length;

  const recommendation = recommend({
    productId,
    hasBrain: Boolean(knowledge && strategy),
    hasKnowledge: Boolean(knowledge),
    drafts: approvals.filter((p) => p.status === "draft").length,
    highIntent: feed.filter((o) => o.intent === "seeking_solution").length,
    feed: feed.length,
    goal,
    goalBlocked: progress?.blocked === "no_event",
    signupEventMissing: !events.signup,
    publishedEver: publishedEver.length,
    unmeasured,
    questions: knowledge?.questions.length ?? 0,
    testing: hypotheses.filter((h) => h.status === "testing").length,
  });

  return {
    goal,
    progress,
    product: knowledge
      ? { what: knowledge.what, highlights, tally: tally(knowledge), questions: knowledge.questions }
      : null,
    market: {
      pains: insights.filter((i) => i.kind === "pain" || i.kind === "complaint").slice(0, 4),
      phrases: [...new Set(insights.filter((i) => i.kind === "phrase" || i.kind === "pain" || i.kind === "search_demand").flatMap((i) => i.userPhrases))].slice(0, 8),
      communities: insights.filter((i) => i.kind === "community").slice(0, 3),
      moves,
    },
    audience: segments,
    positioning,
    strategy,
    experiments: hypotheses.filter((h) => h.status !== "retired").slice(0, 6),
    learnings: learnings.slice(0, 6),
    report,
    week,
    events,
    recommendation,
    approvals,
    upcoming,
    feed,
    activity,
    run,
    policy,
    hasBrain: Boolean(knowledge),
  };
}

export interface RecommendState {
  productId: string;
  hasBrain: boolean;
  hasKnowledge: boolean;
  drafts: number;
  highIntent: number;
  feed: number;
  goal: GrowthGoal | null;
  goalBlocked: boolean;
  signupEventMissing: boolean;
  publishedEver: number;
  unmeasured: number;
  questions: number;
  testing: number;
}

/**
 * One next action, in code, by what is waiting on the person — the same rule
 * as next-step.ts. A draft waits on their decision; a conversation goes stale
 * in a day; a missing number blocks an experiment's verdict; a question
 * sharpens the brain but blocks nothing.
 */
export function recommend(state: RecommendState): Recommendation {
  const base = `/products/${state.productId}/growth`;
  if (!state.hasKnowledge) {
    return {
      headline: "まず、あなたのSaaSを理解させてください",
      why: "URLから製品を読み、市場・顧客・競合を調べて、最初の戦略と1週間分の投稿を用意します。",
      action: null,
    };
  }
  if (!state.hasBrain) {
    return { headline: "分析の続きを実行してください", why: "製品の理解まではできています。市場調査から先がまだです。", action: null };
  }
  if (state.drafts > 0) {
    return {
      headline: `承認を待っている投稿が${state.drafts}件あります`,
      why: "検証中の仮説を確かめるための投稿です。出さないと結果が出ず、Grapeは学べません。直したい箇所は直してから承認してください。",
      action: { label: "確認して承認する", href: `${base}/posts#drafts` },
    };
  }
  if (state.highIntent > 0) {
    return {
      headline: `今まさに解決策を探している人が${state.highIntent}人います`,
      why: "最初のユーザーは、発信より、困っている人への返信から来ることが多いからです。",
      action: { label: "会話を見る", href: `${base}#opportunities` },
    };
  }
  if (state.goalBlocked || (state.signupEventMissing && state.publishedEver > 0)) {
    return {
      headline: "「登録」を数えられるようにしてください",
      why: "登録のイベント名が未設定なので、どの投稿が登録につながったかを測れません。仮説の判定の精度が大きく下がります。",
      action: { label: "計測を設定する", href: `${base}/settings#events` },
    };
  }
  if (state.unmeasured > 0) {
    return {
      headline: `${state.unmeasured}件の投稿の数字が入っていません`,
      why: "表示や反応の数がないと、仮説が当たったかどうかを判定できません。XのAPIが無い場合は、Xのアナリティクスの数字を手で入れてください。",
      action: { label: "数字を入れる", href: `${base}/posts#published` },
    };
  }
  if (state.questions > 0) {
    return {
      headline: `Grapeから${state.questions}件の質問があります`,
      why: "サイトからは分からなかったことです。答えると、推測ではなく事実として投稿や戦略に使えます。",
      action: { label: "質問に答える", href: `${base}/brain#questions` },
    };
  }
  return {
    headline: state.testing > 0 ? "計画どおり投稿を続けましょう" : "次の仮説を用意しています",
    why:
      state.testing > 0
        ? `${state.testing}件の仮説を検証中です。数字がそろい次第、何が効いたかとその理由を書き、戦略を更新します。`
        : "結論の出た仮説から学びを書き、次の検証に移ります。",
    action: null,
  };
}

/** Every fact of the product knowledge in one list, for pages that show them all. */
export function allFacts(knowledge: { what: Fact | null } & Record<(typeof LIST_TOPICS)[number], Fact[]>): Fact[] {
  return [...(knowledge.what ? [knowledge.what] : []), ...LIST_TOPICS.flatMap((topic) => knowledge[topic])];
}
