import { describe, expect, it } from "vitest";

import { createMemoryStore } from "@/db/store/memory";

import { SETUP_LEASE_MS, claimProductSetup } from "./register";

const NOW = new Date("2026-09-25T00:00:00Z");

describe("claimProductSetup", () => {
  it("gives a pending product to exactly one of two simultaneous callers", async () => {
    const db = createMemoryStore();
    const product = await db.products.insert({ userId: "u", url: "https://a.example/", name: "a", setupStatus: "pending" });

    const claims = await Promise.all([claimProductSetup(product.id, db, NOW), claimProductSetup(product.id, db, NOW)]);

    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("lets a claim be taken again once its lease has run out — a request that died mid-crawl", async () => {
    const db = createMemoryStore();
    const product = await db.products.insert({ userId: "u", url: "https://a.example/", name: "a", setupStatus: "pending" });
    await claimProductSetup(product.id, db, NOW);

    expect(await claimProductSetup(product.id, db, new Date(NOW.getTime() + SETUP_LEASE_MS - 1))).toBeNull();
    expect(await claimProductSetup(product.id, db, new Date(NOW.getTime() + SETUP_LEASE_MS + 1))).not.toBeNull();
  });

  it("has nothing to claim on a product that is not pending", async () => {
    const db = createMemoryStore();
    const product = await db.products.insert({ userId: "u", url: "https://a.example/", name: "a", setupStatus: "ready" });

    expect(await claimProductSetup(product.id, db, NOW)).toBeNull();
  });
});
