import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

/**
 * registerProduct writes through the shared `db` from `@/db/client`, so an
 * in-memory database is substituted for it rather than passed in — the same
 * approach current-user.test.ts uses, and necessary here because
 * core/context/crawl and core/context/extract are mocked below and cannot be
 * threaded through any other way.
 */
const db = drizzle(createClient({ url: ":memory:" }), { schema });

vi.mock("@/db/client", () => ({
  get db() {
    return db;
  },
  schema,
}));

const crawlSite = vi.fn();
vi.mock("@/core/context/crawl", () => ({
  crawlSite: (...args: unknown[]) => crawlSite(...args),
  // Pass-through rather than the real implementation: every URL used below is
  // already normalized, and the real module pulls in the Playwright-backed
  // page renderer, which is slow to load for what this file needs from it.
  normalizeUrl: (raw: string) => raw,
}));

const extractProductContext = vi.fn();
vi.mock("@/core/context/extract", () => ({
  extractProductContext: (...args: unknown[]) => extractProductContext(...args),
}));

vi.mock("@/core/llm", () => ({ getProvider: () => ({}) }));

let userId: string;

beforeEach(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.delete(schema.productContexts);
  await db.delete(schema.crawlPages);
  await db.delete(schema.products);
  await db.delete(schema.users);

  // Dynamic import, like the calls to registerProduct below: a static import
  // at module scope resolves @/core/auth/users (and its own @/db/client
  // import) before the `const db` above finishes initializing, and the mocked
  // getter then reads it mid-TDZ.
  const { registerFirstUser } = await import("@/core/auth/users");
  userId = (
    await registerFirstUser(
      { email: "owner@example.com", displayName: "Owner", password: "a-long-enough-password" },
      db,
    )
  ).id;

  crawlSite.mockReset();
  extractProductContext.mockReset();
});

const FAKE_PAGE = { url: "https://example.com/", status: 200, title: "Example", text: "hello", meta: {} };
const FAKE_EXTRACTION = {
  what: "what",
  who: "who",
  why: "why",
  how: "how",
  primaryLanguage: "en",
  evidenceUrls: ["https://example.com/"],
  gaps: [],
  confidence: 0.8,
};

describe("registerProduct", () => {
  /**
   * The bug this whole file exists to pin down: a crawl or extraction failure
   * used to leave a product row behind with no context and no crawl pages —
   * unremovable from the UI before DeleteProductButton existed, and confusing
   * even after, since it looks identical to "still being set up".
   */
  it("undoes a brand-new product when the crawl fails", async () => {
    crawlSite.mockRejectedValue(new Error("DNS lookup failed"));
    const { registerProduct } = await import("./register");

    await expect(
      registerProduct({ url: "https://nope.example.com", userId }),
    ).rejects.toThrow("DNS lookup failed");

    const rows = await db.query.products.findMany();
    expect(rows).toHaveLength(0);
  });

  it("undoes a brand-new product when extraction fails", async () => {
    crawlSite.mockResolvedValue([FAKE_PAGE]);
    extractProductContext.mockRejectedValue(new Error("model unavailable"));
    const { registerProduct } = await import("./register");

    await expect(
      registerProduct({ url: "https://example.com", userId }),
    ).rejects.toThrow("model unavailable");

    expect(await db.query.products.findMany()).toHaveLength(0);
  });

  it("keeps a product that registered successfully", async () => {
    crawlSite.mockResolvedValue([FAKE_PAGE]);
    extractProductContext.mockResolvedValue(FAKE_EXTRACTION);
    const { registerProduct } = await import("./register");

    const result = await registerProduct({ url: "https://example.com", userId });

    expect(await db.query.products.findMany()).toHaveLength(1);
    const context = await db.query.productContexts.findFirst({
      where: eq(schema.productContexts.productId, result.productId),
    });
    expect(context?.what).toBe("what");
  });

  /**
   * Re-registering an existing product is not the same event as creating one.
   * A failed re-crawl must not cost the owner the working context a previous,
   * successful run already produced.
   */
  it("keeps an existing product and its prior context when a re-crawl fails", async () => {
    crawlSite.mockResolvedValue([FAKE_PAGE]);
    extractProductContext.mockResolvedValue(FAKE_EXTRACTION);
    const { registerProduct } = await import("./register");
    const first = await registerProduct({ url: "https://example.com", userId });

    crawlSite.mockRejectedValue(new Error("timed out"));
    await expect(registerProduct({ url: "https://example.com", userId })).rejects.toThrow(
      "timed out",
    );

    const rows = await db.query.products.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.productId);
    const context = await db.query.productContexts.findFirst({
      where: eq(schema.productContexts.productId, first.productId),
    });
    expect(context?.what).toBe("what");
  });
});
