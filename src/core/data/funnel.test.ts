import { describe, expect, it } from "vitest";

import { computeFunnel, type EventRow, type FunnelOptions } from "./funnel";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_START = new Date("2026-08-01T00:00:00Z");
const WINDOW_END = new Date("2026-09-01T00:00:00Z");

function baseOptions(overrides: Partial<FunnelOptions> = {}): FunnelOptions {
  return {
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    keyEventName: "signup",
    coldStartMinSessions: 30,
    ...overrides,
  };
}

function event(overrides: Partial<EventRow> & Pick<EventRow, "anonId" | "sessionId" | "ts">): EventRow {
  return {
    name: "pageview",
    referrer: null,
    utm: null,
    ...overrides,
  };
}

/** One pageview per session — visits, none engaged, none activated. */
function bareSessions(count: number, dayOffset = 5): EventRow[] {
  const rows: EventRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push(
      event({
        anonId: `anon-${i}`,
        sessionId: `session-${i}`,
        ts: new Date(WINDOW_START.getTime() + dayOffset * DAY_MS + i * 1000),
      }),
    );
  }
  return rows;
}

describe("computeFunnel", () => {
  it("counts a single pageview session as a visit but not engaged or activated", () => {
    const rows = bareSessions(1);
    const result = computeFunnel(rows, baseOptions({ coldStartMinSessions: 1 }));

    expect(result.totalSessions).toBe(1);
    const [, engage, activate] = result.stages;
    expect(engage.sessions).toBe(0);
    expect(activate.sessions).toBe(0);
  });

  it("counts a session as engaged once it has a second event", () => {
    const ts = new Date(WINDOW_START.getTime() + DAY_MS);
    const rows: EventRow[] = [
      event({ anonId: "a1", sessionId: "s1", ts }),
      event({ anonId: "a1", sessionId: "s1", name: "click", ts: new Date(ts.getTime() + 5_000) }),
    ];

    const result = computeFunnel(rows, baseOptions({ coldStartMinSessions: 1 }));
    expect(result.stages.find((s) => s.stage === "engage")?.sessions).toBe(1);
  });

  it("counts a session as engaged once it clears 30 seconds, even with only one named event repeated", () => {
    const ts = new Date(WINDOW_START.getTime() + DAY_MS);
    const rows: EventRow[] = [
      event({ anonId: "a1", sessionId: "s1", ts }),
      event({ anonId: "a1", sessionId: "s1", ts: new Date(ts.getTime() + 31_000) }),
    ];

    const result = computeFunnel(rows, baseOptions({ coldStartMinSessions: 1 }));
    expect(result.stages.find((s) => s.stage === "engage")?.sessions).toBe(1);
  });

  it("does not count 29 seconds on a single-event session as engaged", () => {
    const ts = new Date(WINDOW_START.getTime() + DAY_MS);
    const rows: EventRow[] = [event({ anonId: "a1", sessionId: "s1", ts })];
    const result = computeFunnel(rows, baseOptions({ coldStartMinSessions: 1 }));
    expect(result.stages.find((s) => s.stage === "engage")?.sessions).toBe(0);
  });

  it("attributes reach by utm_source over referrer, and referrer over direct", () => {
    const ts = new Date(WINDOW_START.getTime() + DAY_MS);
    const rows: EventRow[] = [
      event({ anonId: "a1", sessionId: "s1", ts, utm: { utm_source: "twitter" } }),
      event({ anonId: "a2", sessionId: "s2", ts, referrer: "https://news.ycombinator.com/item?id=1" }),
      event({ anonId: "a3", sessionId: "s3", ts }),
    ];

    const result = computeFunnel(rows, baseOptions({ coldStartMinSessions: 1 }));
    const bySource = Object.fromEntries(result.reachBySource.map((r) => [r.source, r.sessions]));
    expect(bySource.twitter).toBe(1);
    expect(bySource["news.ycombinator.com"]).toBe(1);
    expect(bySource.direct).toBe(1);
  });

  it("flags cold start when total sessions are below the threshold, and omits a bottleneck", () => {
    const rows = bareSessions(5);
    const result = computeFunnel(rows, baseOptions({ coldStartMinSessions: 30 }));

    expect(result.isColdStart).toBe(true);
    expect(result.bottleneck).toBeNull();
  });

  it("reports no key event as hasKeyEvent: false and skips the activate rate", () => {
    const rows = bareSessions(5);
    const result = computeFunnel(rows, baseOptions({ keyEventName: null, coldStartMinSessions: 1 }));

    expect(result.hasKeyEvent).toBe(false);
    const activate = result.stages.find((s) => s.stage === "activate");
    expect(activate?.sessions).toBe(0);
    expect(activate?.rateFromPrevious).toBeNull();
  });

  it("finds the Activate stage as the bottleneck when it alone is starved", () => {
    // 40 sessions, all engaged (two events each), only 2 activate. Retain is
    // fine (half of activated sessions return). Engage holds steady at 100%.
    const rows: EventRow[] = [];
    for (let i = 0; i < 40; i++) {
      const ts = new Date(WINDOW_START.getTime() + 5 * DAY_MS + i * 60_000);
      rows.push(event({ anonId: `anon-${i}`, sessionId: `s-${i}`, ts }));
      rows.push(event({ anonId: `anon-${i}`, sessionId: `s-${i}`, name: "click", ts: new Date(ts.getTime() + 1000) }));
      if (i < 2) {
        rows.push(event({ anonId: `anon-${i}`, sessionId: `s-${i}`, name: "signup", ts: new Date(ts.getTime() + 2000) }));
      }
    }

    const result = computeFunnel(rows, baseOptions({ coldStartMinSessions: 30 }));

    expect(result.isColdStart).toBe(false);
    expect(result.stages.find((s) => s.stage === "engage")?.sessions).toBe(40);
    expect(result.stages.find((s) => s.stage === "activate")?.sessions).toBe(2);
    expect(result.bottleneck?.stage).toBe("activate");
  });

  it("finds the Engage stage as the bottleneck when most sessions bounce immediately", () => {
    // 40 sessions, only 3 engaged, but of those 3, all 3 activate and retain —
    // Activate and Retain look *perfect* on their own small base, so ranking
    // by rate alone would pick the wrong stage. Ranking by absolute sessions
    // lost correctly blames Engage instead.
    const rows: EventRow[] = [];
    for (let i = 0; i < 40; i++) {
      const ts = new Date(WINDOW_START.getTime() + 5 * DAY_MS + i * 60_000);
      rows.push(event({ anonId: `anon-${i}`, sessionId: `s-${i}`, ts }));
      if (i < 3) {
        rows.push(event({ anonId: `anon-${i}`, sessionId: `s-${i}`, name: "click", ts: new Date(ts.getTime() + 40_000) }));
        rows.push(event({ anonId: `anon-${i}`, sessionId: `s-${i}`, name: "signup", ts: new Date(ts.getTime() + 41_000) }));
      }
    }

    const result = computeFunnel(rows, baseOptions({ coldStartMinSessions: 30 }));

    expect(result.stages.find((s) => s.stage === "engage")?.sessions).toBe(3);
    expect(result.stages.find((s) => s.stage === "activate")?.sessions).toBe(3);
    expect(result.bottleneck?.stage).toBe("engage");
  });

  it("counts a session as retained when the same anon returns within 7 days", () => {
    const first = new Date(WINDOW_START.getTime() + 2 * DAY_MS);
    const returnVisit = new Date(first.getTime() + 3 * DAY_MS);
    const tooLate = new Date(first.getTime() + 10 * DAY_MS);

    const rows: EventRow[] = [
      event({ anonId: "a1", sessionId: "s1", ts: first }),
      event({ anonId: "a1", sessionId: "s2", ts: returnVisit }),
      event({ anonId: "a2", sessionId: "s3", ts: first }),
      event({ anonId: "a2", sessionId: "s4", ts: tooLate }),
    ];

    const result = computeFunnel(rows, baseOptions({ keyEventName: null, coldStartMinSessions: 1 }));
    expect(result.stages.find((s) => s.stage === "retain")?.sessions).toBe(1);
  });

  it("recognises a return visit whose anchor session started before the window", () => {
    const beforeWindow = new Date(WINDOW_START.getTime() - 2 * DAY_MS);
    const returnInWindow = new Date(WINDOW_START.getTime() + DAY_MS);

    const rows: EventRow[] = [
      event({ anonId: "a1", sessionId: "s0", ts: beforeWindow }),
      event({ anonId: "a1", sessionId: "s1", ts: returnInWindow }),
    ];

    const result = computeFunnel(rows, baseOptions({ keyEventName: null, coldStartMinSessions: 1 }));
    expect(result.stages.find((s) => s.stage === "retain")?.sessions).toBe(1);
  });

  it("excludes events outside the window from every stage but still uses them as retention anchors", () => {
    const beforeWindow = new Date(WINDOW_START.getTime() - 3 * DAY_MS);
    const afterWindow = new Date(WINDOW_END.getTime() + DAY_MS);
    const inWindow = new Date(WINDOW_START.getTime() + DAY_MS);

    const rows: EventRow[] = [
      event({ anonId: "a1", sessionId: "s0", ts: beforeWindow }),
      event({ anonId: "a1", sessionId: "s1", ts: inWindow }),
      event({ anonId: "a2", sessionId: "s2", ts: afterWindow }),
    ];

    const result = computeFunnel(rows, baseOptions({ keyEventName: null, coldStartMinSessions: 1 }));
    // s0 (before) and s2 (after) do not count as visits; only s1 does, and it
    // is recognised as a return because of s0.
    expect(result.totalSessions).toBe(1);
    expect(result.stages.find((s) => s.stage === "retain")?.sessions).toBe(1);
  });
});
