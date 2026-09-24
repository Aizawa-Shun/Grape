import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { describe, expect, it } from "vitest";

import * as schema from "@/db/schema";

import { findCarriedOverTasks } from "./carried-over";

async function testDb() {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

type TestDb = Awaited<ReturnType<typeof testDb>>;

async function seed(db: TestDb) {
  const [product] = await db
    .insert(schema.products)
    .values({ userId: "owner", url: "https://example.com/", name: "Example", setupStatus: "ready" })
    .returning();
  const diagnosis = async () =>
    (
      await db
        .insert(schema.diagnoses)
        .values({
          productId: product.id,
          contextVersion: 1,
          windowStart: new Date(),
          windowEnd: new Date(),
          mode: "audit",
          bottleneckStage: "reach",
          summary: "s",
        })
        .returning()
    )[0];
  const older = await diagnosis();
  const latest = await diagnosis();

  const task = async (
    title: string,
    diagnosisId: string,
    status: (typeof schema.TASK_STATUSES)[number],
  ) =>
    (
      await db
        .insert(schema.tasks)
        .values({
          productId: product.id,
          diagnosisId,
          title,
          rationale: "r",
          stage: "reach",
          expectedMetric: "m",
          impact: 3,
          effort: 2,
          dueWeek: "2026-W39",
          status,
          completedAt: status === "done" ? new Date() : null,
        })
        .returning()
    )[0];

  return { product, older, latest, task };
}

describe("findCarriedOverTasks", () => {
  it("returns unfinished work from earlier diagnoses, and nothing from the latest", async () => {
    const db = await testDb();
    const { product, older, latest, task } = await seed(db);

    await task("前回の未着手", older.id, "proposed");
    await task("前回の練習承認", older.id, "approved");
    await task("前回の測定待ち", older.id, "done");
    await task("今回の未着手", latest.id, "proposed");

    const titles = (await findCarriedOverTasks(product.id, latest.id, db)).map((t) => t.title);
    expect(titles.sort()).toEqual(["前回の測定待ち", "前回の未着手", "前回の練習承認"].sort());
  });

  it("leaves out work that is closed: skipped, or done and already measured", async () => {
    const db = await testDb();
    const { product, older, latest, task } = await seed(db);

    await task("やめた", older.id, "skipped");
    const measured = await task("測定済み", older.id, "done");
    await db
      .insert(schema.outcomes)
      .values({ taskId: measured.id, metric: "reach", before: 1, after: 2, windowDays: 7, delta: 1 });

    expect(await findCarriedOverTasks(product.id, latest.id, db)).toEqual([]);
  });
});
