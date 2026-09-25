import { afterEach, describe, expect, it } from "vitest";

import { getRecentOutcomes } from "@/core/intelligence/outcomes";
import { resetSettingsCache, saveSettings } from "@/core/settings";
import { createMemoryStore } from "@/db/store/memory";

import { approveAndExecute } from "./execute";

/** An in-memory store, passed in — execute.ts takes one for exactly this. */
async function testDb() {
  return createMemoryStore();
}

type TestDb = Awaited<ReturnType<typeof testDb>>;

async function seedTask(db: TestDb, channel: "x" | "manual") {
  const product = await db.products.insert({
    userId: "owner",
    url: "https://example.com/",
    name: "Example",
    setupStatus: "ready",
  });
  const task = await db.tasks.insert({
      productId: product.id,
      title: "告知する",
      rationale: "理由",
      stage: "reach",
      channel,
      expectedMetric: "訪問",
      impact: 3,
      effort: 2,
      dueWeek: "2026-W39",
  });
  const artifact = await db.artifacts.insert({
    taskId: task.id,
    kind: channel === "x" ? "x_post" : "lp_copy",
    content: "本文",
  });
  return { product, task, artifact };
}

afterEach(() => {
  resetSettingsCache();
});

describe("approveAndExecute in practice mode", () => {
  it("leaves an x task approved rather than done, with no outcome clock started", async () => {
    const db = await testDb();
    await saveSettings({ GRAPE_ACTION_DRY_RUN: "true" }, db);
    const { task, artifact } = await seedTask(db, "x");

    const run = await approveAndExecute(task.id, artifact.id, { database: db });

    expect(run.status).toBe("dry_run");
    const after = await db.tasks.get(task.id);
    expect(after?.status).toBe("approved");
    expect(after?.completedAt).toBeNull();
  });

  /** A practice approval is not a dead end: once practice mode is off, the same task sends. */
  it("still allows the same task to be approved again afterwards", async () => {
    const db = await testDb();
    await saveSettings({ GRAPE_ACTION_DRY_RUN: "true" }, db);
    const { task, artifact } = await seedTask(db, "x");

    await approveAndExecute(task.id, artifact.id, { database: db });
    await expect(approveAndExecute(task.id, artifact.id, { database: db })).resolves.toMatchObject({
      status: "dry_run",
    });
  });

  it("finishes a manual task, which has nothing to hold back", async () => {
    const db = await testDb();
    await saveSettings({ GRAPE_ACTION_DRY_RUN: "true" }, db);
    const { task, artifact } = await seedTask(db, "manual");

    await approveAndExecute(task.id, artifact.id, { database: db });

    const after = await db.tasks.get(task.id);
    expect(after?.status).toBe("done");
    expect(after?.completedAt).not.toBeNull();
  });
});

describe("getRecentOutcomes", () => {
  it("ignores an outcome recorded against a task that was never actually done", async () => {
    const db = await testDb();
    const { product, task } = await seedTask(db, "x");
    await db.tasks.update(task.id, { status: "approved" });
    await db.outcomes.insert({ taskId: task.id, metric: "reach", before: 1, after: 5, windowDays: 7, delta: 4 });

    expect(await getRecentOutcomes(product.id, 5, db)).toEqual([]);
  });

  it("returns only the latest measurement per done task", async () => {
    const db = await testDb();
    const { product, task } = await seedTask(db, "manual");
    await db.tasks.update(task.id, { status: "done", completedAt: new Date() });
    for (const [after, evaluatedAt] of [
      [2, "2026-01-01"],
      [9, "2026-02-01"],
    ] as const) {
      await db.outcomes.insert({
        taskId: task.id,
        metric: "reach",
        before: 1,
        after,
        windowDays: 7,
        delta: after - 1,
        evaluatedAt: new Date(evaluatedAt),
      });
    }

    const outcomes = await getRecentOutcomes(product.id, 5, db);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].after).toBe(9);
  });
});
