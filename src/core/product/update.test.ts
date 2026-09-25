import { describe, expect, it } from "vitest";

import { createMemoryStore } from "@/db/store/memory";

import { updateProduct } from "./update";

async function testDb() {
  return createMemoryStore();
}

type TestDb = Awaited<ReturnType<typeof testDb>>;

async function product(db: TestDb, userId: string, url: string) {
  return db.products.insert({ userId, url, name: new URL(url).hostname, setupStatus: "ready" });
}

describe("updateProduct", () => {
  it("changes only the fields it is given", async () => {
    const db = await testDb();
    const row = await product(db, "owner", "https://cheeeess.com/");
    await updateProduct(row.id, "owner", { keyEventName: "signup" }, db);

    const updated = await updateProduct(row.id, "owner", { name: "Cheeeess" }, db);

    expect(updated.name).toBe("Cheeeess");
    expect(updated.keyEventName).toBe("signup");
    expect(updated.url).toBe("https://cheeeess.com/");
  });

  it("normalizes a URL typed without a scheme", async () => {
    const db = await testDb();
    const row = await product(db, "owner", "https://cheeeess.com/");

    const updated = await updateProduct(row.id, "owner", { url: "www.cheeeess.com" }, db);

    expect(updated.url).toBe("https://www.cheeeess.com/");
  });

  it("refuses a URL another of the same account's products already uses", async () => {
    const db = await testDb();
    const row = await product(db, "owner", "https://cheeeess.com/");
    await product(db, "owner", "https://other.example/");

    await expect(
      updateProduct(row.id, "owner", { url: "https://other.example/" }, db),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("does not count someone else's product with the same URL as a clash", async () => {
    const db = await testDb();
    const row = await product(db, "owner", "https://cheeeess.com/");
    await product(db, "someone-else", "https://other.example/");

    await expect(
      updateProduct(row.id, "owner", { url: "https://other.example/" }, db),
    ).resolves.toMatchObject({ url: "https://other.example/" });
  });

  /** Indistinguishable from a product that does not exist, like every ownership check here. */
  it("will not touch another account's product", async () => {
    const db = await testDb();
    const row = await product(db, "owner", "https://cheeeess.com/");

    await expect(updateProduct(row.id, "intruder", { name: "x" }, db)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects an empty edit and an address that is not one", async () => {
    const db = await testDb();
    const row = await product(db, "owner", "https://cheeeess.com/");

    await expect(updateProduct(row.id, "owner", {}, db)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(updateProduct(row.id, "owner", { url: "ftp://x" }, db)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});
