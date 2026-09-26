import { db, type Database } from "@/db/client";
import type { Event, GoalMetric, GrowthGoal, Post, Product } from "@/db/schema";

/**
 * What posts did on the product's own site, counted from the tracking
 * snippet's events — no model, no guess.
 *
 * Every growth post that carries a link carries `utm_content=<post id>`
 * (tracking.ts), and g.js stores the UTM tags on each event. So a visit
 * traces to the post it came from, and a signup, an activation or a payment —
 * each an event the owner named — traces to the post whose visitor made it,
 * however many pages later.
 */

export const GROWTH_UTM_CAMPAIGN = "grape";

/** The events that mean each stage. `null` = not named yet, so that stage cannot be counted. */
export interface EventConfig {
  signup: string | null;
  activation: string | null;
  paid: string | null;
}

export function eventConfigOf(product: Pick<Product, "signupEventName" | "keyEventName" | "paidEventName"> | null): EventConfig {
  return {
    signup: product?.signupEventName ?? null,
    // The funnel's "activated" event, named once for both loops (core/data/funnel.ts).
    activation: product?.keyEventName ?? null,
    paid: product?.paidEventName ?? null,
  };
}

export interface PostAttribution {
  /** Sessions that arrived from the post. */
  visits: number;
  /** Distinct people behind them. */
  visitors: number;
  signups: number;
  activations: number;
  paid: number;
}

export const EMPTY_ATTRIBUTION: PostAttribution = { visits: 0, visitors: 0, signups: 0, activations: 0, paid: 0 };

/** Events for a product since `since`, on the (productId, ts) index. */
export async function eventsSince(productId: string, since: Date, conn: Database = db): Promise<Event[]> {
  return conn.events.find({
    where: [
      ["productId", "==", productId],
      ["ts", ">=", since],
    ],
  });
}

/** When each person first fired `name`. */
function firstEventTimes(events: Pick<Event, "anonId" | "name" | "ts">[], name: string | null): Map<string, number> {
  const first = new Map<string, number>();
  if (!name) return first;
  for (const event of events) {
    if (event.name !== name) continue;
    const at = event.ts.getTime();
    if (!first.has(event.anonId) || at < first.get(event.anonId)!) first.set(event.anonId, at);
  }
  return first;
}

/**
 * Per post: sessions that arrived with its utm_content, the distinct visitors
 * behind them, and how many of those visitors went on to sign up, activate
 * and pay — counting an event only if it came at or after their first
 * arrival from that post. Someone who signed up last month and clicked a post
 * today did not sign up because of it.
 */
export function attributePosts(
  events: Pick<Event, "anonId" | "sessionId" | "name" | "utm" | "ts">[],
  postIds: string[],
  config: EventConfig,
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

  const signedUp = firstEventTimes(events, config.signup);
  const activated = firstEventTimes(events, config.activation);
  const paid = firstEventTimes(events, config.paid);

  const result = new Map<string, PostAttribution>();
  for (const postId of postIds) {
    const arrivals = firstArrival.get(postId) ?? new Map<string, number>();
    const after = (times: Map<string, number>) =>
      [...arrivals].filter(([anonId, arrivedAt]) => (times.get(anonId) ?? -Infinity) >= arrivedAt).length;
    result.set(postId, {
      visits: sessions.get(postId)?.size ?? 0,
      visitors: arrivals.size,
      signups: after(signedUp),
      activations: after(activated),
      paid: after(paid),
    });
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
  return attributePosts(events, published.map((post) => post.id), eventConfigOf(product));
}

export interface GoalProgress {
  current: number;
  target: number;
  /** 0–1. */
  ratio: number;
  daysLeft: number;
  /** What pace would reach the target, per day, from today. */
  neededPerDay: number | null;
  /** The event the metric counts has not been named yet, so there is nothing to count. */
  blocked: "no_event" | null;
}

const EVENT_FOR: Record<GoalMetric, keyof EventConfig | null> = {
  visitors: null,
  signups: "signup",
  activations: "activation",
  paid: "paid",
};

/** The event a goal metric counts, or null for "anyone who visited". */
export function goalEvent(metric: GoalMetric, config: EventConfig): { needed: boolean; name: string | null } {
  const key = EVENT_FOR[metric];
  return key ? { needed: true, name: config[key] } : { needed: false, name: null };
}

/** Distinct people who did the thing the goal counts. */
export function countGoal(events: Pick<Event, "anonId" | "name">[], goal: Pick<GrowthGoal, "metric">, config: EventConfig): number {
  const { needed, name } = goalEvent(goal.metric, config);
  const people = new Set<string>();
  for (const event of events) {
    if (needed && event.name !== name) continue;
    people.add(event.anonId);
  }
  return people.size;
}

export async function goalProgress(goal: GrowthGoal, conn: Database = db, now: Date = new Date()): Promise<GoalProgress> {
  const product = await conn.products.get(goal.productId);
  const config = eventConfigOf(product);
  const daysLeft = Math.max(0, Math.ceil((goal.deadline.getTime() - now.getTime()) / 86_400_000));
  const { needed, name } = goalEvent(goal.metric, config);
  if (needed && !name) {
    return { current: 0, target: goal.target, ratio: 0, daysLeft, neededPerDay: null, blocked: "no_event" };
  }
  const events = await eventsSince(goal.productId, goal.startAt, conn);
  const current = countGoal(events, goal, config);
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
