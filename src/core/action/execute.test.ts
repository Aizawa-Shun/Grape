import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, describe, expect, it } from "vitest";

import { getRecentOutcomes } from "@/core/intelligence/outcomes";
import { resetSettingsCache, saveSettings } from "@/core/settings";
import * as schema from "@/db/schema";

import { approveAndExecute } from "./execute";

/** A real migrated in-memory database, passed in — execute.ts takes one for exactly this. */
async function testDb() {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

type TestDb = Awaited<ReturnType<typeof testDb>>;

async function seedTask(db: TestDb, channel: "x" | "manual") {
  const [product] = await db
    .insert(schema.products)
    .values({ userId: "owner", url: "https://example.com/", name: "Example", setupStatus: "ready" })
    .returning();
  const [task] = await db
    .insert(schema.tasks)
    .values({
      productId: product.id,
      title: "告知する",
      rationale: "理由",
      stage: "reach",
      channel,
      expectedMetric: "訪問",
      impact: 3,
      effort: 2,
      dueWeek: "2026-W39",
    })
    .returning();
  const [artifact] = await db
    .insert(schema.artifacts)
    .values({ taskId: task.id, kind: channel === "x" ? "x_post" : "lp_copy", content: "本文" })
    .returning();
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
    const after = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, task.id) });
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

    const after = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, task.id) });
    expect(after?.status).toBe("done");
    expect(after?.completedAt).not.toBeNull();
  });
});

describe("getRecentOutcomes", () => {
  it("ignores an outcome recorded against a task that was never actually done", async () => {
    const db = await testDb();
    const { product, task } = await seedTask(db, "x");
    await db.update(schema.tasks).set({ status: "approved" }).where(eq(schema.tasks.id, task.id));
    await db
      .insert(schema.outcomes)
      .values({ taskId: task.id, metric: "reach", before: 1, after: 5, windowDays: 7, delta: 4 });

    expect(await getRecentOutcomes(product.id, 5, db)).toEqual([]);
  });

  it("returns only the latest measurement per done task", async () => {
    const db = await testDb();
    const { product, task } = await seedTask(db, "manual");
    await db
      .update(schema.tasks)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(schema.tasks.id, task.id));
    await db.insert(schema.outcomes).values([
      { taskId: task.id, metric: "reach", before: 1, after: 2, windowDays: 7, delta: 1, evaluatedAt: new Date("2026-01-01") },
      { taskId: task.id, metric: "reach", before: 1, after: 9, windowDays: 7, delta: 8, evaluatedAt: new Date("2026-02-01") },
    ]);

    const outcomes = await getRecentOutcomes(product.id, 5, db);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].after).toBe(9);
  });
});
