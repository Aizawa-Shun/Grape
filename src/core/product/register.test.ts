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
const siteNameFrom = vi.fn((): string | null => null);
vi.mock("@/core/context/extract", () => ({
  extractProductContext: (...args: unknown[]) => extractProductContext(...args),
  siteNameFrom: () => siteNameFrom(),
}));

const analyzeSaas = vi.fn();
vi.mock("@/core/context/analyze", () => ({
  analyzeSaas: (...args: unknown[]) => analyzeSaas(...args),
}));

const llmAvailable = vi.fn(() => true);
vi.mock("@/core/llm", () => ({ getProvider: () => ({}), llmAvailable: () => llmAvailable() }));

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
  analyzeSaas.mockReset();
  siteNameFrom.mockReset();
  siteNameFrom.mockReturnValue(null);
  llmAvailable.mockReturnValue(true);
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

/** Only the parts contextFromAnalysis reads; the rest of the shape is exercised in derive.test.ts. */
function fakeAnalysis() {
  const text = (value: string) => ({ value, status: "confirmed" as const });
  const list = (items: string[]) => ({ items, status: "confirmed" as const });

  return {
    overview: { oneLiner: "一言", description: "説明", category: "Gaming" },
    service: {
      what: text("分析されたwhat"),
      who: text("分析されたwho"),
      problems: list(["課題"]),
      valueProposition: list(["価値"]),
      features: list(["機能"]),
      usage: text("使い方"),
    },
    targetUsers: { primary: ["主"], secondary: [], status: "inferred" as const },
    business: {
      pricing: text("無料"),
      model: text("フリーミアム"),
      audienceType: text("B2C"),
      revenueSource: text("広告"),
    },
    market: {
      category: text("ゲーム"),
      industry: text("ゲーム"),
      similarServices: list(["chess.com"]),
    },
    insights: { strengths: [], differentiation: [], userNeeds: [], opportunities: [] },
    evidence: [
      { topic: "service.what", url: "https://example.com/", quote: "q", reasoning: "r" },
    ],
    primaryLanguage: "ja",
  };
}

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
    analyzeSaas.mockResolvedValue(fakeAnalysis());

    const { productId } = await register("https://example.com");

    expect((await db.query.products.findFirst())?.setupStatus).toBe("ready");
    const context = await db.query.productContexts.findFirst({
      where: eq(schema.productContexts.productId, productId),
    });
    expect(context?.what).toBe("分析されたwhat");
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

  it("stores the analysis alongside the context it was derived from", async () => {
    crawlSite.mockResolvedValue([FAKE_PAGE]);
    analyzeSaas.mockResolvedValue(fakeAnalysis());

    const { productId } = await register("https://example.com");

    const context = await db.query.productContexts.findFirst({
      where: eq(schema.productContexts.productId, productId),
    });
    expect(context?.analysis?.overview.oneLiner).toBe("一言");
    // The four fields stay authoritative for every prompt downstream, derived
    // from the analysis rather than asked for separately.
    expect(context?.who).toBe("分析されたwho");
  });

  /**
   * A model that fails is worth falling back from, not failing the whole
   * registration over: a rule-based context is worth more than an error page,
   * and re-registering once the model is reachable costs one click.
   */
  it("falls back to the rule-based reading when the analysis call fails", async () => {
    crawlSite.mockResolvedValue([FAKE_PAGE]);
    analyzeSaas.mockRejectedValue(new Error("model unavailable"));
    extractProductContext.mockResolvedValue(FAKE_EXTRACTION);

    const { productId } = await register("https://example.com");

    expect((await db.query.products.findFirst())?.setupStatus).toBe("ready");
    const context = await db.query.productContexts.findFirst({
      where: eq(schema.productContexts.productId, productId),
    });
    expect(context?.what).toBe("what");
    expect(context?.analysis).toBeNull();
  });

  it("never calls the model at all when no provider is configured", async () => {
    llmAvailable.mockReturnValue(false);
    crawlSite.mockResolvedValue([FAKE_PAGE]);
    extractProductContext.mockResolvedValue(FAKE_EXTRACTION);

    await register("https://example.com");

    expect(analyzeSaas).not.toHaveBeenCalled();
    expect((await db.query.products.findFirst())?.setupStatus).toBe("ready");
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
    analyzeSaas.mockResolvedValue(fakeAnalysis());
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
    expect(context?.what).toBe("分析されたwhat");
  });
});

describe("runProductSetup naming", () => {
  it("replaces the hostname placeholder with what the site calls itself", async () => {
    crawlSite.mockResolvedValue([FAKE_PAGE]);
    extractProductContext.mockResolvedValue(FAKE_EXTRACTION);
    llmAvailable.mockReturnValue(false);
    siteNameFrom.mockReturnValue("Cheeeess");

    await register("https://example.com/");

    expect((await db.query.products.findFirst())?.name).toBe("Cheeeess");
  });

  /** A re-read must not undo a name chosen on the review screen. */
  it("leaves a name someone already chose alone", async () => {
    crawlSite.mockResolvedValue([FAKE_PAGE]);
    extractProductContext.mockResolvedValue(FAKE_EXTRACTION);
    llmAvailable.mockReturnValue(false);
    siteNameFrom.mockReturnValue("Cheeeess");

    const { runProductSetup, startProductSetup } = await import("./register");
    const started = await startProductSetup({ url: "https://example.com/", userId });
    await db.update(schema.products).set({ name: "私のチェス" }).where(eq(schema.products.id, started.productId));
    await runProductSetup(started);

    expect((await db.query.products.findFirst())?.name).toBe("私のチェス");
  });
});

describe("normalizeProductUrl", () => {
  it("assumes https when the scheme is left off, as people type addresses", async () => {
    const { normalizeProductUrl } = await import("./register");
    // crawl's normalizeUrl is mocked to a pass-through in this file.
    expect(normalizeProductUrl("cheeeess.com")).toBe("https://cheeeess.com");
    expect(normalizeProductUrl("http://cheeeess.com/")).toBe("http://cheeeess.com/");
    expect(normalizeProductUrl("   ")).toBeNull();
  });

  it("assumes plain http for a server on the reader's own machine", async () => {
    const { normalizeProductUrl } = await import("./register");
    expect(normalizeProductUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeProductUrl("127.0.0.1:8080/app")).toBe("http://127.0.0.1:8080/app");
    expect(normalizeProductUrl("myapp.local")).toBe("http://myapp.local");
  });
});
