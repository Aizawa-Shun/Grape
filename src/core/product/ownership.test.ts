import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@/db/client";
import { createMemoryStore } from "@/db/store/memory";

import { assertProductOwner, assertTaskOwner, findOwnedProduct } from "./ownership";

let db: Database;
const alice = "alice";
const bob = "bob";

beforeEach(async () => {
  db = createMemoryStore();

  await db.users.set(alice, { email: "alice@example.com", displayName: "Alice", role: "owner" });
  await db.users.set(bob, { email: "bob@example.com", displayName: "Bob", role: "member" });

  await db.products.insert({
    id: "alice-product",
    userId: alice,
    url: "https://alice.example.com",
    name: "Alice's service",
  });

  await db.tasks.insert({
    id: "alice-task",
    productId: "alice-product",
    title: "Write a post",
    rationale: "because",
    stage: "reach",
    expectedMetric: "sessions",
    impact: 3,
    effort: 1,
    dueWeek: "2026-W37",
  });
});

describe("assertProductOwner", () => {
  it("returns the product to the account that owns it", async () => {
    const product = await assertProductOwner("alice-product", alice, db);
    expect(product.name).toBe("Alice's service");
  });

  it("refuses another account", async () => {
    await expect(assertProductOwner("alice-product", bob, db)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  /**
   * The two failures must be indistinguishable. A different code or status for
   * "exists but is not yours" would confirm the id is real to anyone who
   * guessed or was shown one — which is the only fact an outsider gains
   * anything from.
   */
  it("fails identically for someone else's product and for one that does not exist", async () => {
    const mine = await assertProductOwner("alice-product", bob, db).catch((e: unknown) => e);
    const nothing = await assertProductOwner("no-such-product", bob, db).catch((e: unknown) => e);

    expect((mine as { code: string }).code).toBe((nothing as { code: string }).code);
  });

  it("has a null-returning form for pages, which say not-found their own way", async () => {
    expect(await findOwnedProduct("alice-product", bob, db)).toBeNull();
    expect(await findOwnedProduct("alice-product", alice, db)).not.toBeNull();
  });
});

describe("assertTaskOwner", () => {
  it("reaches the owner through the product", async () => {
    const { task, product } = await assertTaskOwner("alice-task", alice, db);
    expect(task.title).toBe("Write a post");
    expect(product.userId).toBe(alice);
  });

  /**
   * Approving a task is the one action in Grape that spends money and posts in
   * public, so this is the check that matters most.
   */
  it("refuses another account's task", async () => {
    await expect(assertTaskOwner("alice-task", bob, db)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuses a task that does not exist", async () => {
    await expect(assertTaskOwner("no-such-task", alice, db)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
