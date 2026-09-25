import { describe, expect, it } from "vitest";

import { createMemoryStore } from "@/db/store/memory";
import type { CompetitorSnapshot } from "@/db/schema";

import type { PublicPage } from "./sources/page";
import { describeChanges, recentMoves, snapshotOf, watchCompetitors } from "./watch";

const base: CompetitorSnapshot = {
  title: "RivalApp — Schedule posts",
  description: "Schedule everything",
  headings: ["Schedule posts", "Analytics", "Teams"],
  prices: ["$29/mo"],
  ctas: ["Start free trial"],
};

function page(overrides: Partial<PublicPage> = {}): PublicPage {
  return {
    url: "https://rival.example/",
    title: base.title,
    text: "t",
    meta: { description: base.description! },
    sections: base.headings.map((heading) => ({ heading, body: "" })),
    ctas: base.ctas,
    prices: base.prices,
    links: [],
    manifestUrl: null,
    ...overrides,
  } as PublicPage;
}

describe("describeChanges", () => {
  it("says nothing when the page reads the same", () => {
    expect(describeChanges("RivalApp", base, snapshotOf(page()))).toEqual([]);
  });

  it("reports a new pitch, a new price and a new call to action, quoting them", () => {
    const after = snapshotOf(
      page({
        sections: [{ heading: "Find your first users", body: "" }, { heading: "AI replies", body: "" }, { heading: "Teams", body: "" }] as PublicPage["sections"],
        prices: ["$19/mo"],
        ctas: ["Start free trial", "Book a demo"],
      }),
    );
    const changes = describeChanges("RivalApp", base, after).join("\n");
    expect(changes).toContain("見出し");
    expect(changes).toContain("「Find your first users」");
    expect(changes).toContain("$29/mo → $19/mo");
    expect(changes).toContain("「Book a demo」");
  });

  it("ignores one rotating heading below the first", () => {
    const after = { ...base, headings: ["Schedule posts", "Analytics", "New this week"] };
    expect(describeChanges("RivalApp", base, after)).toEqual([]);
  });
});

describe("watchCompetitors", () => {
  it("records a move, moves the baseline, and skips what it could not read", async () => {
    const conn = createMemoryStore();
    const common = {
      productId: "p1",
      runId: "r0",
      pricing: "",
      positioning: "",
      targetAudience: "",
      features: [],
      messaging: "",
      contentStrategy: "",
      strengths: [],
      weaknesses: [],
      differentiation: "",
      snapshot: base,
    };
    const rival = await conn.competitors.insert({ ...common, name: "RivalApp", url: "https://rival.example/" });
    await conn.competitors.insert({ ...common, name: "DownApp", url: "https://down.example/" });

    const result = await watchCompetitors(
      await conn.competitors.find(),
      async (url) => (url.includes("rival") ? page({ prices: ["$19/mo"] }) : null),
      "r1",
      conn,
    );
    expect(result).toMatchObject({ checked: 1, unreachable: 1 });
    expect((await conn.competitors.get(rival.id))!.snapshot!.prices).toEqual(["$19/mo"]);

    const [move] = await recentMoves("p1", 14, conn);
    expect(move).toMatchObject({ kind: "competitor_move", grounded: true });
    expect(move.statement).toContain("$19/mo");

    // The next day, nothing new.
    const again = await watchCompetitors(await conn.competitors.find(), async () => page({ prices: ["$19/mo"] }), "r2", conn);
    expect(again.moves.filter((m) => m.competitor.name === "RivalApp")).toEqual([]);
  });
});
