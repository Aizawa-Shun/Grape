import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryStore } from "./memory";
import type { Store } from "./types";

/**
 * One behaviour, two stores. The in-memory store is what almost every other
 * test runs on, so it has to behave like Firestore wherever a caller could
 * notice — and this is where that is checked.
 *
 * The Firestore half runs only when FIRESTORE_EMULATOR_HOST is set, which
 * `pnpm test:emulators` does (it starts the emulator, runs the suite, stops
 * it). CI runs it; a plain `pnpm test` without Java skips it.
 */

type Factory = { name: string; create: () => Promise<Store>; cleanup?: () => Promise<void> };

const factories: Factory[] = [{ name: "memory", create: async () => createMemoryStore() }];

if (process.env.FIRESTORE_EMULATOR_HOST) {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "demo-grape";
  factories.push({
    name: "firestore",
    create: async () => {
      const { firestore } = await import("../firebase");
      const { createFirestoreStore } = await import("./firestore");
      // Wipe the emulator between tests — its REST endpoint does this in one call.
      await fetch(
        `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
        { method: "DELETE" },
      );
      return createFirestoreStore(firestore());
    },
  });
}

describe.each(factories)("Store contract ($name)", ({ create }) => {
  let store: Store;

  beforeEach(async () => {
    store = await create();
  });

  it("fills in defaults, keeps explicit nulls, and returns Dates as Dates", async () => {
    const product = await store.products.insert({ userId: "u1", url: "https://a.example/", name: "A" });

    expect(product.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(product.setupStatus).toBe("ready");
    expect(product.keyEventName).toBeNull();
    expect(product.createdAt).toBeInstanceOf(Date);

    const read = await store.products.get(product.id);
    expect(read).toEqual(product);
    expect(read?.createdAt).toBeInstanceOf(Date);
  });

  it("filters by equality, including == null, and orders and limits", async () => {
    await store.tasks.insert(task("p1", "a", 3, null));
    await store.tasks.insert(task("p1", "b", 5, "d1"));
    await store.tasks.insert(task("p1", "c", 4, null));
    await store.tasks.insert(task("p2", "d", 1, null));

    const noDiagnosis = await store.tasks.find({
      where: [
        ["productId", "==", "p1"],
        ["diagnosisId", "==", null],
      ],
      orderBy: [["impact", "desc"]],
    });
    expect(noDiagnosis.map((t) => t.title)).toEqual(["c", "a"]);

    const top = await store.tasks.first({ where: [["productId", "==", "p1"]], orderBy: [["impact", "desc"]] });
    expect(top?.title).toBe("b");
  });

  it("compares Dates in range filters", async () => {
    const base = new Date("2026-09-01T00:00:00Z");
    for (const days of [0, 3, 6, 9]) {
      await store.events.insert({
        productId: "p1",
        anonId: "a",
        sessionId: `s${days}`,
        name: "pageview",
        ts: new Date(base.getTime() + days * 86_400_000),
      });
    }

    const window = await store.events.find({
      where: [
        ["productId", "==", "p1"],
        ["ts", ">=", new Date("2026-09-03T00:00:00Z")],
        ["ts", "<", new Date("2026-09-08T00:00:00Z")],
      ],
      orderBy: [["ts", "asc"]],
    });
    expect(window.map((e) => e.sessionId)).toEqual(["s3", "s6"]);
  });

  it("splits an `in` over Firestore's limit and still orders and limits the merged result", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 45; i++) {
      const row = await store.tasks.insert(task("p1", `t${String(i).padStart(2, "0")}`, i % 5, null));
      ids.push(row.id);
    }

    const byProduct = await store.tasks.find({
      where: [["title", "in", ids.map((_, i) => `t${String(i).padStart(2, "0")}`)]],
      orderBy: [["title", "desc"]],
      limit: 3,
    });
    expect(byProduct.map((t) => t.title)).toEqual(["t44", "t43", "t42"]);
  });

  it("counts and sums", async () => {
    for (const cost of [0.5, 1.25, 2]) {
      await store.llmCalls.insert({
        userId: "u1",
        taskKind: "diagnose",
        provider: "anthropic",
        model: "m",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: cost,
      });
    }
    await store.llmCalls.insert({
      userId: "u2",
      taskKind: "diagnose",
      provider: "anthropic",
      model: "m",
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 10,
    });

    expect(await store.llmCalls.count([["userId", "==", "u1"]])).toBe(3);
    expect(await store.llmCalls.sum("costUsd", [["userId", "==", "u1"]])).toBeCloseTo(3.75, 5);
    expect(await store.llmCalls.sum("costUsd", [["userId", "==", "nobody"]])).toBe(0);
  });

  it("updates only what is given, and reports a missing document instead of creating one", async () => {
    const product = await store.products.insert({ userId: "u1", url: "https://a.example/", name: "A" });

    const updated = await store.products.update(product.id, { name: "B", keyEventName: undefined });
    expect(updated?.name).toBe("B");
    expect(updated?.url).toBe("https://a.example/");

    expect(await store.products.update("missing", { name: "x" })).toBeNull();
    expect(await store.products.get("missing")).toBeNull();
  });

  it("refuses to insert over an existing id, but set replaces", async () => {
    await store.settings.insert({ id: "K", value: "1" });
    await expect(store.settings.insert({ id: "K", value: "2" })).rejects.toThrow();

    await store.settings.set("K", { value: "3" });
    expect((await store.settings.get("K"))?.value).toBe("3");
  });

  it("deletes by filter and says how many", async () => {
    await store.tasks.insert(task("p1", "a", 1, null));
    await store.tasks.insert(task("p1", "b", 1, null));
    await store.tasks.insert(task("p2", "c", 1, null));

    expect(await store.tasks.deleteWhere([["productId", "==", "p1"]])).toBe(2);
    expect((await store.tasks.find()).map((t) => t.title)).toEqual(["c"]);
  });

  it("rolls a transaction back entirely when it throws", async () => {
    await expect(
      store.runTransaction(async (tx) => {
        await tx.users.get("u1");
        await tx.users.set("u1", { email: "a@example.com", displayName: "A" });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    expect(await store.users.get("u1")).toBeNull();
  });

  /** Firestore's rule: every read before the first write. Two updates after one read must be fine. */
  it("allows several updates in one transaction after its reads", async () => {
    const a = await store.products.insert({ userId: "u1", url: "https://a.example/", name: "A" });
    const b = await store.products.insert({ userId: "u1", url: "https://b.example/", name: "B" });

    await store.runTransaction(async (tx) => {
      await tx.products.find({ where: [["userId", "==", "u1"]] });
      await tx.products.update(a.id, { name: "A2" });
      await tx.products.update(b.id, { name: "B2" });
    });

    expect((await store.products.get(a.id))?.name).toBe("A2");
    expect((await store.products.get(b.id))?.name).toBe("B2");
  });

  it("commits a transaction's reads and writes together", async () => {
    await store.runTransaction(async (tx) => {
      const existing = await tx.users.find({ limit: 1 });
      await tx.users.set("u1", {
        email: "a@example.com",
        displayName: "A",
        role: existing.length === 0 ? "owner" : "member",
      });
    });

    expect((await store.users.get("u1"))?.role).toBe("owner");
  });
});

function task(productId: string, title: string, impact: number, diagnosisId: string | null) {
  return {
    productId,
    diagnosisId,
    title,
    rationale: "r",
    stage: "reach" as const,
    expectedMetric: "m",
    impact,
    effort: 1,
    dueWeek: "2026-W39",
  };
}
