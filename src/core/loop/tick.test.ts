import { afterEach, describe, expect, it } from "vitest";

import { AppError } from "@/core/errors";
import { resetSettingsCache, saveSettings } from "@/core/settings";
import type { TaskStatus } from "@/db/schema";
import { createMemoryStore } from "@/db/store/memory";
import { currentUserId } from "@/server/context";

import { runLoopTick } from "./tick";

const NOW = new Date("2026-09-24T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

async function testDb() {
  return createMemoryStore();
}

type TestDb = Awaited<ReturnType<typeof testDb>>;

async function product(db: TestDb, userId: string, url: string, lastDiagnosedDaysAgo: number | null) {
  const row = await db.products.insert({ userId, url, name: url, setupStatus: "ready" });
  if (lastDiagnosedDaysAgo !== null) {
    await db.diagnoses.insert({
      productId: row.id,
      contextVersion: 1,
      windowStart: daysAgo(lastDiagnosedDaysAgo + 7),
      windowEnd: daysAgo(lastDiagnosedDaysAgo),
      mode: "audit",
      bottleneckStage: "reach",
      summary: "s",
      createdAt: daysAgo(lastDiagnosedDaysAgo),
    });
  }
  return row;
}

async function task(
  db: TestDb,
  productId: string,
  status: TaskStatus,
  completedDaysAgo: number | null,
) {
  return db.tasks.insert({
      productId,
      title: `${status}-${completedDaysAgo}`,
      rationale: "r",
      stage: "reach",
      expectedMetric: "m",
      impact: 3,
      effort: 2,
      dueWeek: "2026-W39",
      status,
      completedAt: completedDaysAgo === null ? null : daysAgo(completedDaysAgo),
  });
}

afterEach(() => {
  resetSettingsCache();
});

describe("runLoopTick — measuring", () => {
  it("measures only work finished at least a week ago that has no outcome yet", async () => {
    const db = await testDb();
    const p = await product(db, "owner", "https://a.example/", null);
    const due = await task(db, p.id, "done", 8);
    await task(db, p.id, "done", 3); // too early
    await task(db, p.id, "approved", null); // practice run: never done
    const measuredAlready = await task(db, p.id, "done", 20);
    await db.outcomes.insert({
      taskId: measuredAlready.id,
      metric: "reach",
      before: 1,
      after: 2,
      windowDays: 7,
      delta: 1,
    });

    const measuredIds: string[] = [];
    const result = await runLoopTick({
      now: NOW,
      database: db,
      measure: async (taskId) => void measuredIds.push(taskId),
      rediagnose: async () => undefined,
    });

    expect(measuredIds).toEqual([due.id]);
    expect(result.measured).toBe(1);
  });

  it("keeps going past a task that fails to measure", async () => {
    const db = await testDb();
    const p = await product(db, "owner", "https://a.example/", null);
    await task(db, p.id, "done", 8);
    await task(db, p.id, "done", 9);

    const result = await runLoopTick({
      now: NOW,
      database: db,
      measure: async () => {
        throw new Error("funnel unavailable");
      },
    });

    expect(result.measured).toBe(0);
    expect(result.failed).toHaveLength(2);
  });
});

describe("runLoopTick — re-diagnosing", () => {
  it("re-diagnoses only stale products that have been diagnosed before, as their owner", async () => {
    const db = await testDb();
    await saveSettings({ LLM_PROVIDER: "anthropic" }, db);
    const stale = await product(db, "alice", "https://stale.example/", 8);
    await product(db, "bob", "https://fresh.example/", 2);
    await product(db, "carol", "https://never.example/", null);

    const calls: { productId: string; asUser: string | undefined }[] = [];
    const result = await runLoopTick({
      now: NOW,
      database: db,
      measure: async () => undefined,
      rediagnose: async (productId) => void calls.push({ productId, asUser: currentUserId() }),
    });

    expect(calls).toEqual([{ productId: stale.id, asUser: "alice" }]);
    expect(result.diagnosed).toBe(1);
  });

  /** A missing key or a spent budget is the owner's setup, not a fault in the run. */
  it("skips an owner who cannot pay for a call, and reports anything else as failed", async () => {
    const db = await testDb();
    await saveSettings({ LLM_PROVIDER: "anthropic" }, db);
    const noKey = await product(db, "alice", "https://a.example/", 10);
    const broken = await product(db, "bob", "https://b.example/", 10);

    const result = await runLoopTick({
      now: NOW,
      database: db,
      measure: async () => undefined,
      rediagnose: async (productId) => {
        if (productId === noKey.id) throw new AppError("LLM_NOT_CONFIGURED", "no key");
        throw new Error("model exploded");
      },
    });

    expect(result.skipped).toEqual([{ productId: noKey.id, reason: "LLM_NOT_CONFIGURED" }]);
    expect(result.failed.map((f) => f.productId)).toEqual([broken.id]);
  });

  it("does not attempt a diagnosis at all when the instance has no AI selected", async () => {
    const db = await testDb();
    await product(db, "alice", "https://a.example/", 10);

    let called = false;
    const result = await runLoopTick({
      now: NOW,
      database: db,
      measure: async () => undefined,
      rediagnose: async () => void (called = true),
    });

    expect(called).toBe(false);
    expect(result.diagnosed).toBe(0);
  });
});
