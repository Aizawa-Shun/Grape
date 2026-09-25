import { describe, expect, it } from "vitest";

import { createMemoryStore } from "@/db/store/memory";

import { deleteProduct } from "./delete";

async function seed() {
  const db = createMemoryStore();
  const mine = await db.products.insert({ userId: "owner", url: "https://a.example/", name: "A" });
  const other = await db.products.insert({ userId: "owner", url: "https://b.example/", name: "B" });

  for (const product of [mine, other]) {
    await db.productContexts.insert({
      productId: product.id,
      version: 1,
      what: "w",
      who: "w",
      why: "w",
      how: "w",
      sourcePages: [],
    });
    await db.events.insert({ productId: product.id, anonId: "a", sessionId: "s", name: "pageview", ts: new Date() });
    const task = await db.tasks.insert({
      productId: product.id,
      title: "t",
      rationale: "r",
      stage: "reach",
      expectedMetric: "m",
      impact: 1,
      effort: 1,
      dueWeek: "2026-W39",
    });
    await db.artifacts.insert({ taskId: task.id, kind: "lp_copy", content: "c" });
    await db.outcomes.insert({ taskId: task.id, metric: "m", before: 1, after: 2, windowDays: 7, delta: 1 });
    await db.llmCalls.insert({
      productId: product.id,
      userId: "owner",
      taskKind: "diagnose",
      provider: "anthropic",
      model: "m",
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 1,
    });
  }
  return { db, mine, other };
}

describe("deleteProduct", () => {
  it("removes the product and everything reasoned from it, and nothing of another product", async () => {
    const { db, mine, other } = await seed();

    await deleteProduct(mine.id, "owner", db);

    expect(await db.products.get(mine.id)).toBeNull();
    for (const name of ["productContexts", "events", "tasks"] as const) {
      const rows = (await db[name].find()) as { productId: string }[];
      expect(rows.every((row) => row.productId === other.id), name).toBe(true);
      expect(rows.length, name).toBe(1);
    }
    expect(await db.artifacts.count()).toBe(1);
    expect(await db.outcomes.count()).toBe(1);
  });

  /** The spend happened whether or not the product still exists. */
  it("keeps the LLM calls on the books, with the product cleared", async () => {
    const { db, mine } = await seed();

    await deleteProduct(mine.id, "owner", db);

    const calls = await db.llmCalls.find();
    expect(calls).toHaveLength(2);
    expect(calls.filter((call) => call.productId === null)).toHaveLength(1);
  });

  it("will not delete another account's product", async () => {
    const { db, mine } = await seed();

    await expect(deleteProduct(mine.id, "intruder", db)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.products.get(mine.id)).not.toBeNull();
  });
});
