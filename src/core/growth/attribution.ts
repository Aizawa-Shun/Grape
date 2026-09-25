import { db, type Database } from "@/db/client";
import type { Event, GrowthGoal, Post } from "@/db/schema";

/**
 * What posts did on the product's own site, counted from the tracking
 * snippet's events — no model, no guess.
 *
 * Every growth post that carries a link carries `utm_content=<post id>`
 * (tracking.ts), and g.js stores the UTM tags on each event. So a visit
 * traces to the post it came from, and a signup — the product's key event —
 * traces to the post whose visitor made it, however many pages later.
 */

export const GROWTH_UTM_CAMPAIGN = "grape";

export interface PostAttribution {
  visits: number;
  visitors: number;
  signups: number;
}

/** Events for a product since `since`, on the (productId, ts) index. */
export async function eventsSince(productId: string, since: Date, conn: Database = db): Promise<Event[]> {
  return conn.events.find({
    where: [
      ["productId", "==", productId],
      ["ts", ">=", since],
    ],
  });
}

/**
 * Per post: sessions that arrived with its utm_content, the distinct visitors
 * behind them, and how many of those visitors fired the key event at or after
 * their first arrival from that post.
 */
export function attributePosts(
  events: Pick<Event, "anonId" | "sessionId" | "name" | "utm" | "ts">[],
  postIds: string[],
  keyEventName: string | null,
): Map<string, PostAttribution> {
  const wanted = new Set(postIds);
  const sessions = new Map<string, Set<string>>();
  const firstArrival = new Map<string, Map<string, number>>();

  for (const event of events) {
    const postId = event.utm?.utm_content;
    if (!postId || !wanted.has(postId)) continue;
    if (!sessions.has(postId)) sessions.set(postId, new Set());
    sessions.get(postId)!.add(event.sessionId);
    if (!firstArrival.has(postId)) firstArrival.set(postId, new Map());
    const arrivals = firstArrival.get(postId)!;
    const at = event.ts.getTime();
    if (!arrivals.has(event.anonId) || at < arrivals.get(event.anonId)!) arrivals.set(event.anonId, at);
  }

  const conversions = new Map<string, number>();
  if (keyEventName) {
    for (const event of events) {
      if (event.name !== keyEventName) continue;
      const at = event.ts.getTime();
      if (!conversions.has(event.anonId) || at < conversions.get(event.anonId)!) conversions.set(event.anonId, at);
    }
  }

  const result = new Map<string, PostAttribution>();
  for (const postId of postIds) {
    const arrivals = firstArrival.get(postId) ?? new Map<string, number>();
    let signups = 0;
    for (const [anonId, arrivedAt] of arrivals) {
      const convertedAt = conversions.get(anonId);
      if (convertedAt !== undefined && convertedAt >= arrivedAt) signups += 1;
    }
    result.set(postId, { visits: sessions.get(postId)?.size ?? 0, visitors: arrivals.size, signups });
  }
  return result;
}

export async function attributionFor(
  productId: string,
  posts: Pick<Post, "id" | "publishedAt">[],
  conn: Database = db,
): Promise<Map<string, PostAttribution>> {
  const published = posts.filter((post) => post.publishedAt);
  if (published.length === 0) return new Map();
  const since = new Date(Math.min(...published.map((post) => post.publishedAt!.getTime())));
  const product = await conn.products.get(productId);
  const events = await eventsSince(productId, since, conn);
  return attributePosts(events, published.map((post) => post.id), product?.keyEventName ?? null);
}

export interface GoalProgress {
  current: number;
  target: number;
  /** 0–1. */
  ratio: number;
  daysLeft: number;
  /** What pace would reach the target, per day, from today. */
  neededPerDay: number | null;
  /** Null when the metric cannot be counted yet — signups without a key event. */
  blocked: "no_key_event" | null;
}

/** Signups are distinct visitors who fired the key event; visitors are distinct visitors at all. */
export function countGoal(
  events: Pick<Event, "anonId" | "name">[],
  goal: Pick<GrowthGoal, "metric">,
  keyEventName: string | null,
): number {
  const people = new Set<string>();
  for (const event of events) {
    if (goal.metric === "signups" && event.name !== keyEventName) continue;
    people.add(event.anonId);
  }
  return people.size;
}

export async function goalProgress(
  goal: GrowthGoal,
  conn: Database = db,
  now: Date = new Date(),
): Promise<GoalProgress> {
  const product = await conn.products.get(goal.productId);
  const keyEventName = product?.keyEventName ?? null;
  const daysLeft = Math.max(0, Math.ceil((goal.deadline.getTime() - now.getTime()) / 86_400_000));
  if (goal.metric === "signups" && !keyEventName) {
    return { current: 0, target: goal.target, ratio: 0, daysLeft, neededPerDay: null, blocked: "no_key_event" };
  }
  const events = await eventsSince(goal.productId, goal.startAt, conn);
  const current = countGoal(events, goal, keyEventName);
  const remaining = Math.max(0, goal.target - current);
  return {
    current,
    target: goal.target,
    ratio: goal.target > 0 ? Math.min(1, current / goal.target) : 0,
    daysLeft,
    neededPerDay: daysLeft > 0 ? Math.round((remaining / daysLeft) * 10) / 10 : null,
    blocked: null,
  };
}
