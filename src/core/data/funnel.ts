import { and, eq, gte, lte } from "drizzle-orm";

import { AppError } from "@/core/errors";
import { env } from "@/env";
import { db, schema } from "@/db/client";

/**
 * Turns the raw event stream into the 5-stage funnel (spec's Reach / Visit /
 * Engage / Activate / Retain) and, deterministically, which transition is
 * losing the most sessions.
 *
 * This is arithmetic, not reasoning, and it stays that way on purpose: the
 * LLM's job (diagnose.ts, M3) is to explain why a stage is leaking and what to
 * do about it, using Product Context. Whether it is leaking has one correct
 * answer, computed the same way every time from the same rows — so it lives
 * here, in code, unit-testable without a model in the loop.
 */

export interface EventRow {
  anonId: string;
  sessionId: string;
  name: string;
  referrer: string | null;
  utm: Record<string, string> | null;
  ts: Date;
}

export type SequentialStage = "visit" | "engage" | "activate" | "retain";

export interface ReachSource {
  source: string;
  sessions: number;
}

export interface FunnelStageResult {
  stage: SequentialStage;
  sessions: number;
  /**
   * The stage this one's rate is measured against. Null means no rate is
   * defined — either this is the first stage (Visit), or Activate has no
   * keyEventName yet so nothing downstream can be compared to it.
   */
  comparedTo: number | null;
  rateFromPrevious: number | null;
}

export interface Bottleneck {
  stage: SequentialStage;
  rateFromPrevious: number;
  /** Sessions lost at this transition. The ranking key — see findBottleneck. */
  sessionsLost: number;
}

export interface FunnelOptions {
  windowStart: Date;
  windowEnd: Date;
  /** Null until the product owner picks one; Activate and Retain degrade without it. */
  keyEventName: string | null;
  coldStartMinSessions: number;
}

export interface FunnelResult extends FunnelOptions {
  totalSessions: number;
  reachBySource: ReachSource[];
  stages: FunnelStageResult[];
  /** Below coldStartMinSessions, percentages are noise — see spec section 6's audit fallback. */
  isColdStart: boolean;
  hasKeyEvent: boolean;
  bottleneck: Bottleneck | null;
}

/** A session with only a single pageview and no time on page is not "engaged". */
const ENGAGE_MIN_EVENTS = 2;
const ENGAGE_MIN_DURATION_MS = 30_000;
const RETAIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** How far outside windowStart an anon_id's events are still consulted, to tell whether a session inside the window is a return. */
export const RETAIN_LOOKBACK_MS = RETAIN_WINDOW_MS;

export function computeFunnel(rows: EventRow[], options: FunnelOptions): FunnelResult {
  const inWindow = rows.filter((row) => row.ts >= options.windowStart && row.ts <= options.windowEnd);

  const sessions = groupBySession(inWindow);
  const totalSessions = sessions.size;

  const reachBySource = reachBreakdown(sessions);

  let engaged = 0;
  let activated = 0;
  for (const session of sessions.values()) {
    if (isEngaged(session.events)) engaged += 1;
    if (options.keyEventName && session.events.some((event) => event.name === options.keyEventName)) {
      activated += 1;
    }
  }

  const retained = countRetainedSessions(rows, sessions);

  const activateBasis = options.keyEventName ? engaged : null;
  const retainBasis = options.keyEventName ? activated : engaged;

  const stages: FunnelStageResult[] = [
    { stage: "visit", sessions: totalSessions, comparedTo: null, rateFromPrevious: null },
    { stage: "engage", sessions: engaged, comparedTo: totalSessions, rateFromPrevious: rate(engaged, totalSessions) },
    {
      stage: "activate",
      sessions: options.keyEventName ? activated : 0,
      comparedTo: activateBasis,
      rateFromPrevious: activateBasis === null ? null : rate(activated, activateBasis),
    },
    {
      stage: "retain",
      sessions: retained,
      comparedTo: retainBasis,
      rateFromPrevious: rate(retained, retainBasis),
    },
  ];

  const isColdStart = totalSessions < options.coldStartMinSessions;

  return {
    ...options,
    totalSessions,
    reachBySource,
    stages,
    isColdStart,
    hasKeyEvent: Boolean(options.keyEventName),
    // Below the cold-start floor, "worst transition" is noise dressed up as a
    // finding — a handful of sessions makes any rate swing wildly. The caller
    // (M3's diagnose.ts) is expected to fall back to a static audit instead.
    bottleneck: isColdStart ? null : findBottleneck(stages),
  };
}

interface Session {
  anonId: string;
  events: EventRow[];
}

function groupBySession(rows: EventRow[]): Map<string, Session> {
  const sessions = new Map<string, Session>();
  for (const row of rows) {
    let session = sessions.get(row.sessionId);
    if (!session) {
      session = { anonId: row.anonId, events: [] };
      sessions.set(row.sessionId, session);
    }
    session.events.push(row);
  }
  return sessions;
}

function isEngaged(events: EventRow[]): boolean {
  if (events.length >= ENGAGE_MIN_EVENTS) return true;
  const times = events.map((event) => event.ts.getTime());
  return Math.max(...times) - Math.min(...times) >= ENGAGE_MIN_DURATION_MS;
}

/** Attribution key for a session: its UTM source if tagged, else the referrer's host, else "direct". */
function sourceOf(session: Session): string {
  const withUtm = session.events.find((event) => event.utm?.utm_source);
  if (withUtm?.utm) return withUtm.utm.utm_source;

  const withReferrer = session.events.find((event) => event.referrer);
  if (!withReferrer?.referrer) return "direct";
  try {
    return new URL(withReferrer.referrer).hostname;
  } catch {
    return "direct";
  }
}

function reachBreakdown(sessions: Map<string, Session>): ReachSource[] {
  const counts = new Map<string, number>();
  for (const session of sessions.values()) {
    const source = sourceOf(session);
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, count]) => ({ source, sessions: count }))
    .sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source));
}

/**
 * A session counts toward Retain if the same anon_id has an earlier session
 * that started within the past 7 days — i.e. this session is itself the
 * return visit. Needs every row for the anon_id, not just the ones inside the
 * window, so a return on day 1 of the window is still recognised as a return
 * even though its earlier session started before the window began.
 */
function countRetainedSessions(allRows: EventRow[], sessionsInWindow: Map<string, Session>): number {
  const sessionStartsByAnon = new Map<string, Map<string, number>>();
  for (const row of allRows) {
    let byAnon = sessionStartsByAnon.get(row.anonId);
    if (!byAnon) {
      byAnon = new Map();
      sessionStartsByAnon.set(row.anonId, byAnon);
    }
    const t = row.ts.getTime();
    const current = byAnon.get(row.sessionId);
    if (current === undefined || t < current) byAnon.set(row.sessionId, t);
  }

  let retained = 0;
  for (const [sessionId, session] of sessionsInWindow) {
    const sessionStart = Math.min(...session.events.map((event) => event.ts.getTime()));
    const othersByAnon = sessionStartsByAnon.get(session.anonId);
    if (!othersByAnon) continue;

    for (const [otherId, otherStart] of othersByAnon) {
      if (otherId === sessionId) continue;
      if (otherStart < sessionStart && sessionStart - otherStart <= RETAIN_WINDOW_MS) {
        retained += 1;
        break;
      }
    }
  }
  return retained;
}

function rate(numerator: number, denominator: number | null): number | null {
  if (!denominator) return null;
  return numerator / denominator;
}

/**
 * Ranks transitions by absolute sessions lost, not by rate alone — a stage
 * with a catastrophic rate over a handful of sessions matters less than one
 * with a merely bad rate over most of the funnel. That is the plan's
 * "weighted by inflow" loss, expressed as one number.
 */
function findBottleneck(stages: FunnelStageResult[]): Bottleneck | null {
  let worst: Bottleneck | null = null;
  for (const stage of stages) {
    if (stage.comparedTo === null || stage.comparedTo === 0 || stage.rateFromPrevious === null) continue;
    const lost = stage.comparedTo - stage.sessions;
    if (lost <= 0) continue;
    if (!worst || lost > worst.sessionsLost) {
      worst = { stage: stage.stage, rateFromPrevious: stage.rateFromPrevious, sessionsLost: lost };
    }
  }
  return worst;
}

export interface GetFunnelOptions {
  windowDays?: number;
  /** Injectable for tests; defaults to the real clock. */
  now?: Date;
}

export async function getFunnel(productId: string, options: GetFunnelOptions = {}): Promise<FunnelResult> {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? 30;
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  return getFunnelForRange(productId, windowStart, windowEnd);
}

/**
 * The general form `getFunnel` is a convenience wrapper around: any window,
 * not just "the last N days ending now". outcomes.ts needs this directly to
 * compare a before-window and an after-window straddling the moment a task
 * was completed, neither of which ends "now".
 */
export async function getFunnelForRange(
  productId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<FunnelResult> {
  const lookbackStart = new Date(windowStart.getTime() - RETAIN_LOOKBACK_MS);

  const product = await db.query.products.findFirst({ where: eq(schema.products.id, productId) });
  if (!product) throw new AppError("NOT_FOUND", `Unknown product: ${productId}`);

  const rows = await db.query.events.findMany({
    where: and(
      eq(schema.events.productId, productId),
      gte(schema.events.ts, lookbackStart),
      lte(schema.events.ts, windowEnd),
    ),
    columns: { anonId: true, sessionId: true, name: true, referrer: true, utm: true, ts: true },
  });

  return computeFunnel(rows, {
    windowStart,
    windowEnd,
    keyEventName: product.keyEventName,
    coldStartMinSessions: env.COLD_START_MIN_SESSIONS,
  });
}
