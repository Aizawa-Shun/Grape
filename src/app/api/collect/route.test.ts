import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Store } from "@/db/store/types";

/**
 * Through the real handler, not computeFunnel alone: the UTM bug this guards
 * lived in the gap between the two. g.js sent `utm_source`, this route only
 * listed `source`, and the funnel test passed because it fed `utm_source`
 * straight into computeFunnel without ever going through /api/collect.
 */
let db: Store;

vi.mock("@/db/client", () => ({
  get db() {
    return db;
  },
}));

/**
 * Imported per test rather than at module scope, like register.test.ts: a
 * static import (of this route, or anything reaching core/settings) resolves the mocked @/db/client before `db` above has
 * finished initializing.
 */
async function POST(request: Request) {
  const route = await import("./route");
  return route.POST(request);
}

const PRODUCT_ID = "7f1c8a52-3a4b-4c9d-8e2f-1a2b3c4d5e6f";

beforeEach(async () => {
  const { createMemoryStore } = await import("@/db/store/memory");
  db = createMemoryStore();
  await db.products.insert({
    id: PRODUCT_ID,
    userId: "owner",
    url: "https://example.com/",
    name: "Example",
    setupStatus: "ready",
  });
});

function post(body: unknown): Request {
  return new Request("http://localhost/api/collect", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/collect", () => {
  it("keeps the utm_* keys g.js sends, so Reach can attribute a tagged visit", async () => {
    const response = await POST(
      post({
        productId: PRODUCT_ID,
        anonId: "a1",
        sessionId: "s1",
        name: "pageview",
        utm: { utm_source: "twitter", utm_campaign: "launch" },
      }),
    );
    expect(response.status).toBe(204);

    const rows = await db.events.find();
    expect(rows[0].utm).toEqual({ utm_source: "twitter", utm_campaign: "launch" });

    // Dynamic for the same reason as POST below: funnel.ts reaches @/db/client.
    const { computeFunnel } = await import("@/core/data/funnel");
    const funnel = computeFunnel(
      rows.map((row) => ({ ...row, utm: row.utm ?? null })),
      {
        windowStart: new Date(Date.now() - 60_000),
        windowEnd: new Date(Date.now() + 60_000),
        keyEventName: null,
        coldStartMinSessions: 1,
      },
    );
    expect(funnel.reachBySource).toEqual([{ source: "twitter", sessions: 1 }]);
  });

  it("drops utm keys it does not know rather than storing arbitrary JSON", async () => {
    await POST(
      post({
        productId: PRODUCT_ID,
        anonId: "a1",
        sessionId: "s1",
        name: "pageview",
        utm: { utm_source: "x", injected: "y" },
      }),
    );

    const rows = await db.events.find();
    expect(rows[0].utm).toEqual({ utm_source: "x" });
  });
});
