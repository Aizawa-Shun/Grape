import type { MeasurementFunnel, Post } from "@/db/schema";

import { type EventConfig, type PostAttribution } from "./attribution";

/**
 * The funnel a post feeds (spec §8): impressions → engagement → profile
 * visits → website visits → signups → activation → paid.
 *
 * Every number is a sum of counts — from X's metrics for the top, from the
 * tracking snippet's events for the bottom. `null` means "not measured", and
 * it is kept distinct from zero all the way to the screen: a funnel that
 * showed 0 signups because nobody named the signup event would be lying in
 * the direction that makes a founder give up.
 */

type Measured = Pick<Post, "metrics">;

function sum(values: (number | null | undefined)[]): number | null {
  const known = values.filter((value): value is number => typeof value === "number");
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

export function engagementsOf(metrics: NonNullable<Post["metrics"]>): number | null {
  return sum([metrics.likes, metrics.replies, metrics.reposts, metrics.quotes, metrics.bookmarks]);
}

export function buildFunnel(
  posts: (Measured & { id: string })[],
  attribution: Map<string, PostAttribution>,
  config: EventConfig,
): MeasurementFunnel {
  const rows = posts.map((post) => ({ metrics: post.metrics, a: attribution.get(post.id) }));
  const total = (pick: (a: PostAttribution) => number) => rows.reduce((s, r) => s + (r.a ? pick(r.a) : 0), 0);
  return {
    posts: posts.length,
    impressions: sum(rows.map((r) => r.metrics?.impressions)),
    engagements: sum(rows.map((r) => (r.metrics ? engagementsOf(r.metrics) : null))),
    profileVisits: sum(rows.map((r) => r.metrics?.profileVisits)),
    websiteVisitors: total((a) => a.visitors),
    signups: config.signup ? total((a) => a.signups) : null,
    activations: config.activation ? total((a) => a.activations) : null,
    paid: config.paid ? total((a) => a.paid) : null,
  };
}

export type FunnelStageKey = "impressions" | "engagements" | "profileVisits" | "websiteVisitors" | "signups" | "activations" | "paid";

export interface FunnelRow {
  key: FunnelStageKey;
  label: string;
  value: number | null;
  /** How this stage relates to the one it follows, when that relation is a real subset. */
  rate: { label: string; value: number } | null;
  /** Why a stage is empty, when it is. */
  missing: string | null;
}

function ratio(part: number | null, whole: number | null): number | null {
  return part !== null && whole !== null && whole > 0 ? part / whole : null;
}

/**
 * The funnel as rows for the screen. The top four are compared with
 * impressions — people who visit did not necessarily engage first, so a
 * "visits per engagement" rate would not mean anything. From the visit down,
 * each stage is a subset of the last (a signup was a visitor), so the rate is
 * a real conversion.
 */
export function funnelRows(funnel: MeasurementFunnel): FunnelRow[] {
  const per = (label: string, value: number | null) => {
    const r = ratio(value, funnel.impressions);
    return r === null ? null : { label, value: r };
  };
  const step = (label: string, part: number | null, whole: number | null) => {
    const r = ratio(part, whole);
    return r === null ? null : { label, value: r };
  };
  const noMetrics = "Xの数字がまだありません（APIか手入力で取り込みます）";
  const noEvent = (name: string) => `${name}を数えるイベントが未設定です`;
  const lastBeforePaid = funnel.activations !== null ? funnel.activations : funnel.signups;
  return [
    { key: "impressions", label: "表示", value: funnel.impressions, rate: null, missing: funnel.impressions === null ? noMetrics : null },
    { key: "engagements", label: "反応", value: funnel.engagements, rate: per("対表示", funnel.engagements), missing: funnel.engagements === null ? noMetrics : null },
    { key: "profileVisits", label: "プロフィール訪問", value: funnel.profileVisits, rate: per("対表示", funnel.profileVisits), missing: funnel.profileVisits === null ? noMetrics : null },
    { key: "websiteVisitors", label: "サイト訪問（人）", value: funnel.websiteVisitors, rate: per("対表示", funnel.websiteVisitors), missing: null },
    { key: "signups", label: "登録", value: funnel.signups, rate: step("訪問から", funnel.signups, funnel.websiteVisitors), missing: funnel.signups === null ? noEvent("登録") : null },
    { key: "activations", label: "アクティベーション", value: funnel.activations, rate: step("登録から", funnel.activations, funnel.signups), missing: funnel.activations === null ? noEvent("アクティベーション") : null },
    { key: "paid", label: "課金", value: funnel.paid, rate: step(funnel.activations !== null ? "アクティベーションから" : "登録から", funnel.paid, lastBeforePaid), missing: funnel.paid === null ? noEvent("課金") : null },
  ];
}
