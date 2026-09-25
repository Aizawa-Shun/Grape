import type { ContentPillar, MarketingStrategy, Post, PostType, TypeStats } from "@/db/schema";

import type { PostAttribution } from "./attribution";
import { normalizeShares } from "./mix";

/**
 * The numbers behind "what worked", decided in code (spec §21).
 *
 * CTR alone would reward a clickbait hook that nobody signs up from, so each
 * post type is scored on three things at once — engagement, clicks through to
 * the site, and signups — each scaled against the best type, with signups
 * weighted highest because they are what the goal counts. A type with one
 * lucky post is pulled toward the average rather than crowned: with a handful
 * of posts, noise is most of the signal.
 */

export const MIN_POSTS_TO_LEARN = 4;
const WEIGHTS = { engagement: 0.3, click: 0.3, signup: 0.4 };
/** Pseudo-posts of "average" blended into each type's score. */
const PRIOR_POSTS = 2;

export interface PostPerformance {
  post: Pick<Post, "id" | "postType" | "pillar" | "hook" | "text" | "metrics" | "publishedAt">;
  attribution: PostAttribution;
}

function engagementsOf(post: PostPerformance["post"]): number {
  const m = post.metrics;
  if (!m) return 0;
  return (m.likes ?? 0) + (m.replies ?? 0) + (m.reposts ?? 0) + (m.quotes ?? 0) + (m.bookmarks ?? 0) + (m.profileVisits ?? 0);
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function typeStats(performances: PostPerformance[]): TypeStats[] {
  const byType = new Map<PostType, PostPerformance[]>();
  for (const perf of performances) {
    const list = byType.get(perf.post.postType) ?? [];
    list.push(perf);
    byType.set(perf.post.postType, list);
  }

  const raw = [...byType.entries()].map(([postType, list]) => {
    const impressions = list.reduce((s, p) => s + (p.post.metrics?.impressions ?? 0), 0);
    const engagements = list.reduce((s, p) => s + engagementsOf(p.post), 0);
    const visits = list.reduce((s, p) => s + p.attribution.visits, 0);
    const signups = list.reduce((s, p) => s + p.attribution.signups, 0);
    return {
      postType,
      posts: list.length,
      impressions,
      engagements,
      engagementRate: rate(engagements, impressions),
      visits,
      clickRate: rate(visits, impressions),
      signups,
      signupsPerPost: signups / list.length,
    };
  });

  const max = (pick: (r: (typeof raw)[number]) => number | null) => Math.max(0, ...raw.map((r) => pick(r) ?? 0));
  const maxEng = max((r) => r.engagementRate);
  const maxClick = max((r) => r.clickRate);
  const maxSignup = max((r) => r.signupsPerPost);
  const scale = (value: number | null, top: number) => (top > 0 && value !== null ? value / top : 0);

  const scored = raw.map((r) => ({
    ...r,
    rawScore:
      WEIGHTS.engagement * scale(r.engagementRate, maxEng) +
      WEIGHTS.click * scale(r.clickRate, maxClick) +
      WEIGHTS.signup * scale(r.signupsPerPost, maxSignup),
  }));
  const mean = scored.length > 0 ? scored.reduce((s, r) => s + r.rawScore, 0) / scored.length : 0;

  return scored
    .map(({ signupsPerPost: _unused, rawScore, ...rest }) => ({
      ...rest,
      score: Math.round(((rawScore * rest.posts + mean * PRIOR_POSTS) / (rest.posts + PRIOR_POSTS)) * 100) / 100,
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * GrowthStrategist's arithmetic: re-weight the pillars by how their post types
 * scored. Each pillar's share moves by at most half in either direction per
 * round and never drops below 5%, so one bad week cannot delete a pillar that
 * a strategy chose for a reason. Pillars with no measured posts keep their
 * share. Null when there is too little data to learn anything.
 */
export function reweightPillars(strategy: Pick<MarketingStrategy, "pillars">, stats: TypeStats[]): ContentPillar[] | null {
  const measuredPosts = stats.reduce((s, t) => s + t.posts, 0);
  if (measuredPosts < MIN_POSTS_TO_LEARN) return null;

  const scoreOf = new Map(stats.map((t) => [t.postType, t]));
  const pillarScore = (pillar: ContentPillar): number | null => {
    const rows = pillar.postTypes.map((type) => scoreOf.get(type)).filter((row): row is TypeStats => Boolean(row));
    const posts = rows.reduce((s, r) => s + r.posts, 0);
    return posts > 0 ? rows.reduce((s, r) => s + r.score * r.posts, 0) / posts : null;
  };

  const scores = strategy.pillars.map(pillarScore);
  const known = scores.filter((s): s is number => s !== null);
  if (known.length < 2) return null;
  const mean = known.reduce((a, b) => a + b, 0) / known.length;

  const adjusted = strategy.pillars.map((pillar, i) => {
    const score = scores[i];
    if (score === null || mean <= 0) return pillar;
    const multiplier = Math.min(1.5, Math.max(0.5, score / mean));
    return { ...pillar, share: Math.max(5, pillar.share * multiplier) };
  });
  return normalizeShares(adjusted);
}

/** The mix as `{pillar: share}`, for the before/after the report shows. */
export function mixOf(pillars: Pick<ContentPillar, "name" | "share">[]): Record<string, number> {
  return Object.fromEntries(pillars.map((pillar) => [pillar.name, pillar.share]));
}
