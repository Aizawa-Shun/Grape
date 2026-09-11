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

vi.mock("@/core/llm", () => ({ getProvider: () => ({}), llmAvailable: () => true }));

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

async function register(url: string) {
  const { runProductSetup, startProductSetup } = await import("./register");
  const started = await startProductSetup({ url, userId });
  await runProductSetup(started);
  return started;
}

describe("startProductSetup", () => {
  /**
   * The whole point of the split: this half must not touch the network, so the
   * POST behind it can answer before any of the slow work begins.
   */
  it("creates the row as pending without reading the site", async () => {
    const { startProductSetup } = await import("./register");

    const started = await startProductSetup({ url: "https://example.com", userId });

    expect(crawlSite).not.toHaveBeenCalled();
    const [row] = await db.query.products.findMany();
    expect(row.id).toBe(started.productId);
    expect(row.setupStatus).toBe("pending");
  });

  /** A second attempt is a fresh one — whatever the last failure said no longer applies. */
  it("puts an already-failed product back to pending when it is registered again", async () => {
    crawlSite.mockRejectedValue(new Error("DNS lookup failed"));
    const first = await register("https://example.com");
    expect((await db.query.products.findFirst())?.setupStatus).toBe("failed");

    const { startProductSetup } = await import("./register");
    const again = await startProductSetup({ url: "https://example.com", userId });

    expect(again.productId).toBe(first.productId);
    const row = await db.query.products.findFirst();
    expect(row?.setupStatus).toBe("pending");
    expect(row?.setupError).toBeNull();
  });
});

describe("runProductSetup", () => {
  it("records the context and marks the product ready", async () => {
    crawlSite.mockResolvedValue([FAKE_PAGE]);
    extractProductContext.mockResolvedValue(FAKE_EXTRACTION);

    const { productId } = await register("https://example.com");

    expect((await db.query.products.findFirst())?.setupStatus).toBe("ready");
    const context = await db.query.productContexts.findFirst({
      where: eq(schema.productContexts.productId, productId),
    });
    expect(context?.what).toBe("what");
  });

  /**
   * Nothing is awaiting this, so a thrown error would go nowhere at all — the
   * row is the only place a failure can still be seen from.
   */
  it("records a crawl failure on the row instead of throwing", async () => {
    crawlSite.mockRejectedValue(new Error("DNS lookup failed"));

    await expect(register("https://nope.example.com")).resolves.toBeDefined();

    const row = await db.query.products.findFirst();
    expect(row?.setupStatus).toBe("failed");
    expect(row?.setupError).toBeTruthy();
  });

  it("records an extraction failure the same way", async () => {
    crawlSite.mockResolvedValue([FAKE_PAGE]);
    extractProductContext.mockRejectedValue(new Error("model unavailable"));

    await register("https://example.com");

    expect((await db.query.products.findFirst())?.setupStatus).toBe("failed");
  });

  /**
   * The row used to be deleted on a failed first crawl. It cannot be any more:
   * the reader is already on its page by the time this runs, and deleting it
   * turns a failure they could act on into a 404 they cannot.
   */
  it("leaves a failed product in place, so its page can explain itself", async () => {
    crawlSite.mockRejectedValue(new Error("DNS lookup failed"));

    await register("https://nope.example.com");

    expect(await db.query.products.findMany()).toHaveLength(1);
  });

  /**
   * Re-registering an existing product is not the same event as creating one.
   * A failed re-crawl must not cost the owner the working context a previous,
   * successful run already produced.
   */
  it("keeps the prior context when a re-crawl fails", async () => {
    crawlSite.mockResolvedValue([FAKE_PAGE]);
    extractProductContext.mockResolvedValue(FAKE_EXTRACTION);
    const first = await register("https://example.com");

    crawlSite.mockRejectedValue(new Error("timed out"));
    await register("https://example.com");

    const rows = await db.query.products.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.productId);
    expect(rows[0]?.setupStatus).toBe("failed");

    const context = await db.query.productContexts.findFirst({
      where: eq(schema.productContexts.productId, first.productId),
    });
    expect(context?.what).toBe("what");
  });
});
