import type { Confidence, GroupRates, HypothesisResult, Post, Verdict } from "@/db/schema";

import type { PostAttribution } from "./attribution";
import { engagementsOf } from "./measurement";

/**
 * Whether a hypothesis held, decided in code (spec §9).
 *
 * The posts written for a hypothesis are compared with every other published
 * post — the baseline — on the rate that matters most among those that were
 * measured: signups per visitor when there are enough visitors to say, clicks
 * per impression when there are impressions, engagement otherwise. The verdict
 * needs a minimum amount of evidence before it says anything, and a clear
 * margin before it says "supported" or "refuted"; short of either it is
 * "inconclusive", and that is reported as a result in its own right, never
 * hidden. A model explains the verdict afterwards; it does not reach it.
 */

export const MIN_POSTS = 3;
/** Below this many impressions per post, a rate is noise. */
const MIN_IMPRESSIONS_PER_POST = 50;
/** A difference smaller than this is not a difference. */
const MARGIN = 0.25;
const MIN_VISITORS_FOR_SIGNUP_RATE = 20;

export interface PostOutcome {
  post: Pick<Post, "id" | "hypothesisId" | "metrics" | "publishedAt">;
  attribution: PostAttribution;
}

interface GroupTotals {
  posts: number;
  measuredPosts: number;
  impressions: number | null;
  engagements: number | null;
  visitors: number;
  signups: number | null;
}

function totals(outcomes: PostOutcome[], signupsCounted: boolean): GroupTotals {
  const measured = outcomes.filter((o) => o.post.metrics && o.post.metrics.impressions !== null);
  const impressions = measured.length ? measured.reduce((s, o) => s + (o.post.metrics!.impressions ?? 0), 0) : null;
  const engagements = measured.length ? measured.reduce((s, o) => s + (engagementsOf(o.post.metrics!) ?? 0), 0) : null;
  return {
    posts: outcomes.length,
    measuredPosts: measured.length,
    impressions,
    engagements,
    visitors: outcomes.reduce((s, o) => s + o.attribution.visitors, 0),
    signups: signupsCounted ? outcomes.reduce((s, o) => s + o.attribution.signups, 0) : null,
  };
}

function rates(t: GroupTotals): GroupRates {
  const div = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? a / b : null);
  return {
    engagementRate: div(t.engagements, t.impressions),
    clickRate: div(t.visitors, t.impressions),
    signupRate: div(t.signups, t.visitors),
  };
}

type Metric = "signupRate" | "clickRate" | "engagementRate";
const METRIC_LABEL: Record<Metric, string> = { signupRate: "訪問から登録", clickRate: "表示から訪問", engagementRate: "反応率" };

/** The rate that can carry a verdict, from the strongest signal down. */
function choose(group: GroupTotals, baseline: GroupTotals): Metric | null {
  const enough = (t: GroupTotals) => t.impressions !== null && t.impressions >= MIN_IMPRESSIONS_PER_POST * Math.max(1, t.measuredPosts);
  if (group.signups !== null && group.visitors >= MIN_VISITORS_FOR_SIGNUP_RATE && baseline.visitors >= MIN_VISITORS_FOR_SIGNUP_RATE) return "signupRate";
  if (enough(group) && enough(baseline)) return (group.visitors + baseline.visitors) > 0 ? "clickRate" : "engagementRate";
  return null;
}

function confidenceOf(group: GroupTotals, lift: number): Confidence {
  const strength = Math.abs(lift);
  if (group.measuredPosts >= 5 && strength >= 0.5) return "high";
  if (group.measuredPosts >= MIN_POSTS && strength >= MARGIN) return "medium";
  return "low";
}

const pct = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(1)}%`);

export function evaluateHypothesis(hypothesisId: string, outcomes: PostOutcome[], signupsCounted: boolean, now: Date): HypothesisResult {
  const mine = outcomes.filter((o) => o.post.hypothesisId === hypothesisId);
  const rest = outcomes.filter((o) => o.post.hypothesisId !== hypothesisId);
  const group = totals(mine, signupsCounted);
  const base = totals(rest, signupsCounted);
  const groupRates = rates(group);
  const baseRates = rates(base);

  const result = (verdict: Verdict, confidence: Confidence, lift: number | null, reason: string): HypothesisResult => ({
    posts: group.posts,
    measuredPosts: group.measuredPosts,
    impressions: group.impressions,
    engagements: group.engagements,
    visits: group.visitors,
    signups: group.signups,
    ...groupRates,
    baseline: { posts: base.posts, ...baseRates },
    lift,
    verdict,
    confidence,
    reason,
    evaluatedAt: now,
  });

  if (group.posts < MIN_POSTS) {
    return result("inconclusive", "low", null, `公開した投稿が${group.posts}本で、判断には${MIN_POSTS}本以上必要です。`);
  }
  if (base.posts < MIN_POSTS) {
    return result("inconclusive", "low", null, `比べる相手（他の仮説の投稿）が${base.posts}本しかなく、比較できません。`);
  }
  const metric = choose(group, base);
  if (!metric) {
    return result(
      "inconclusive",
      "low",
      null,
      "表示の数字が足りず（Xの数字の取り込みが必要です）、サイト訪問も比較できるほどありません。",
    );
  }
  const mineRate = groupRates[metric];
  const baseRate = baseRates[metric];
  if (mineRate === null || baseRate === null) {
    return result("inconclusive", "low", null, `${METRIC_LABEL[metric]}を比べられる数字がそろっていません。`);
  }
  if (baseRate === 0) {
    return mineRate > 0
      ? result("supported", "low", null, `${METRIC_LABEL[metric]}が ${pct(mineRate)}、他の投稿は0でした。まだ件数が少ないので確度は低めです。`)
      : result("inconclusive", "low", null, `${METRIC_LABEL[metric]}は、この仮説も他の投稿も0でした。`);
  }
  const lift = (mineRate - baseRate) / baseRate;
  const verdict: Verdict = lift >= MARGIN ? "supported" : lift <= -MARGIN ? "refuted" : "inconclusive";
  const compare = `${METRIC_LABEL[metric]}が ${pct(mineRate)}（他の投稿は ${pct(baseRate)}、差 ${lift >= 0 ? "+" : ""}${Math.round(lift * 100)}%）`;
  const reason =
    verdict === "inconclusive"
      ? `${compare}。${Math.round(MARGIN * 100)}%以上の差がないので、はっきりした違いとは言えません。`
      : `${compare}。`;
  return result(verdict, verdict === "inconclusive" ? "low" : confidenceOf(group, lift), Math.round(lift * 100) / 100, reason);
}
