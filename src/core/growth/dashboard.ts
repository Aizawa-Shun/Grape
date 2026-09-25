import { db, type Database } from "@/db/client";
import type { AgentAction, GrowthGoal, GrowthPolicy, GrowthRun, MarketInsight, Opportunity, Post } from "@/db/schema";
import { by } from "@/db/sort";

import { recentActions } from "./activity";
import { attributePosts, eventsSince, GROWTH_UTM_CAMPAIGN, goalProgress, type GoalProgress } from "./attribution";
import { latestInsights } from "./latest";
import { getPolicy } from "./policy";
import { activeRun } from "./runs";
import { activeGoal, latestReport } from "./latest";

/**
 * Everything the growth home shows, gathered in one place and counted in
 * code. The page renders; it does not decide.
 *
 * The recommendation follows the same order of preference as the rest of the
 * app's advice: the latest analysis of real results when there is one; before
 * any results exist, the one action that unblocks the loop, stated with why.
 */

const WEEK_MS = 7 * 86_400_000;

export interface WeekNumbers {
  posts: number;
  replies: number;
  opportunities: number;
  visits: number;
  signups: number;
}

export interface Recommendation {
  headline: string;
  why: string;
  source: "analysis" | "state";
}

export interface GrowthDashboard {
  goal: GrowthGoal | null;
  progress: GoalProgress | null;
  week: WeekNumbers;
  recommendation: Recommendation;
  feed: Opportunity[];
  highIntentCount: number;
  contentIdeas: MarketInsight[];
  approvals: Post[];
  activity: AgentAction[];
  run: GrowthRun | null;
  policy: GrowthPolicy;
  hasKnowledge: boolean;
  hasKeyEvent: boolean;
}

export async function loadGrowthDashboard(productId: string, conn: Database = db, now: Date = new Date()): Promise<GrowthDashboard> {
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const [product, knowledge, goal, policy, posts, opportunities, insights, report, activity, run] = await Promise.all([
    conn.products.get(productId),
    conn.productKnowledge.get(productId),
    activeGoal(productId, conn),
    getPolicy(productId, conn),
    conn.posts.find({ where: [["productId", "==", productId]] }),
    conn.opportunities.find({ where: [["productId", "==", productId]] }),
    latestInsights(productId, conn),
    latestReport(productId, conn),
    recentActions(productId, 15, conn),
    activeRun(productId, conn),
  ]);

  const progress = goal ? await goalProgress(goal, conn, now) : null;

  const published = posts.filter((p) => p.status === "published" && p.publishedAt && p.publishedAt >= weekAgo);
  const events = await eventsSince(productId, weekAgo, conn);
  const growthEvents = events.filter((e) => e.utm?.utm_campaign === GROWTH_UTM_CAMPAIGN);
  const attribution = attributePosts(
    events,
    posts.filter((p) => p.status === "published").map((p) => p.id),
    product?.keyEventName ?? null,
  );

  const week: WeekNumbers = {
    posts: published.filter((p) => p.kind === "post").length,
    replies: published.filter((p) => p.kind === "reply").length,
    opportunities: opportunities.filter((o) => o.createdAt >= weekAgo).length,
    visits: new Set(growthEvents.map((e) => e.sessionId)).size,
    signups: [...attribution.values()].reduce((sum, a) => sum + a.signups, 0),
  };

  const open = opportunities.filter((o) => o.status === "new" || o.status === "drafted");
  const feed = open.filter((o) => o.relevance >= policy.minRelevance).sort(by((o) => o.relevance, "desc")).slice(0, 12);
  const highIntentCount = open.filter((o) => o.relevance >= policy.minRelevance && o.intent === "seeking_solution").length;
  const approvals = posts
    .filter((p) => p.status === "draft" || p.status === "failed" || (p.status === "approved" && (p.dryRun || !p.publishedAt)))
    .sort(by((p) => p.plannedFor ?? p.createdAt.toISOString()));

  const recommendation = recommend({
    hasKnowledge: Boolean(knowledge),
    goal,
    progress,
    reportRecommendation: report?.recommendation ?? null,
    reportActions: report?.nextActions ?? [],
    drafts: approvals.length,
    publishedEver: posts.filter((p) => p.status === "published").length,
    highIntentCount,
    feedCount: feed.length,
    hasKeyEvent: Boolean(product?.keyEventName),
  });

  return {
    goal,
    progress,
    week,
    recommendation,
    feed,
    highIntentCount,
    contentIdeas: insights.filter((i) => i.kind === "gap" || i.kind === "trend" || i.kind === "unmet_need").slice(0, 4),
    approvals,
    activity,
    run,
    policy,
    hasKnowledge: Boolean(knowledge),
    hasKeyEvent: Boolean(product?.keyEventName),
  };
}

export function recommend(state: {
  hasKnowledge: boolean;
  goal: GrowthGoal | null;
  progress: GoalProgress | null;
  reportRecommendation: string | null;
  reportActions: string[];
  drafts: number;
  publishedEver: number;
  highIntentCount: number;
  feedCount: number;
  hasKeyEvent: boolean;
}): Recommendation {
  if (!state.hasKnowledge) {
    return { headline: "まずプロダクトの分析を始めましょう", why: "市場・競合・ICPを調べて、最初の戦略と投稿案を作ります。", source: "state" };
  }
  if (state.reportRecommendation && state.publishedEver >= 2) {
    return {
      headline: state.reportRecommendation,
      why: state.reportActions.length ? `次の施策: ${state.reportActions.join(" / ")}` : "公開した投稿の結果を分析した結論です。",
      source: "analysis",
    };
  }
  if (state.highIntentCount > 0) {
    return {
      headline: `解決策を探している人が${state.highIntentCount}人います。返信から始めましょう`,
      why: `関連度の高い会話が${state.feedCount}件見つかり、そのうち${state.highIntentCount}件は今まさに解決策を探しています。投稿より返信のほうが、最初のユーザーには届きやすいです。`,
      source: "state",
    };
  }
  if (state.drafts > 0) {
    return {
      headline: `承認を待っている案が${state.drafts}件あります`,
      why: "戦略の週間計画に沿って作った投稿案です。確認して承認すると、計画が動き出します。",
      source: "state",
    };
  }
  if (state.goal && !state.hasKeyEvent && state.goal.metric === "signups") {
    return {
      headline: "登録を数えられるように、キーイベントを設定しましょう",
      why: "目標は「登録」ですが、どのイベントが登録なのかが未設定なので、進み具合を数えられません。",
      source: "state",
    };
  }
  return {
    headline: "計画どおり続けましょう",
    why: "毎日、新しい会話を探して投稿案を補充します。結果がたまると、何が効いたかを分析して配分を変えます。",
    source: "state",
  };
}
