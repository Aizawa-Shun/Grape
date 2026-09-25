import { describe, expect, it } from "vitest";

import { EMPTY_USAGE, type LLMProvider } from "@/core/llm/types";

import type { ConversationCandidate } from "../sources/types";
import { intentScore, prefilter, scoreCandidates } from "./opportunity-finder";

function candidate(id: string, text: string, days = 1): ConversationCandidate {
  return { source: "hackernews", externalId: id, url: `https://news.ycombinator.com/item?id=${id}`, author: "u", text, postedAt: new Date(Date.now() - days * 86_400_000) };
}

describe("intentScore", () => {
  it("scores people asking for help above people announcing things", () => {
    expect(intentScore("Is there a tool that finds users for my SaaS? Looking for recommendations")).toBeGreaterThan(
      intentScore("We just launched version 2 of our product today"),
    );
  });

  it("reads Japanese requests for help", () => {
    expect(intentScore("マーケティングが面倒。いいツールないかな？")).toBeGreaterThan(0);
  });
});

describe("prefilter", () => {
  it("drops what was seen before, what is blocked, and what is too short to judge", () => {
    const kept = prefilter(
      [
        candidate("1", "Is there a tool to find customers for my indie SaaS?"),
        candidate("2", "Looking for a casino affiliate program, anyone know one?"),
        candidate("3", "ok"),
        candidate("4", "How do I get my first users for a side project?"),
      ],
      { seen: new Set(["hackernews:4"]), blockKeywords: ["casino"], keywords: [], limit: 10 },
    );
    expect(kept.map((c) => c.externalId)).toEqual(["1"]);
  });

  it("ranks intent and keywords ahead of the rest", () => {
    const kept = prefilter(
      [candidate("a", "Our company blog post about databases and scaling"), candidate("b", "How do I find users for my SaaS? Anyone know a tool?")],
      { seen: new Set(), blockKeywords: [], keywords: ["users"], limit: 1 },
    );
    expect(kept[0].externalId).toBe("b");
  });
});

describe("scoreCandidates", () => {
  const provider = (results: unknown[]): LLMProvider => ({
    name: "fake",
    model: "fake",
    health: async () => ({ ok: true, provider: "fake", model: "fake", detail: "" }),
    completeText: async () => ({ value: "", usage: EMPTY_USAGE, model: "fake" }),
    completeStructured: async <T,>() => ({ value: { results } as T, usage: EMPTY_USAGE, model: "fake" }),
  });

  /** Spec §12: a score is never shown without its reasons — so it is not kept either. */
  it("drops a score that came back without reasons, and an index that does not exist", async () => {
    const shortlist = [candidate("1", "Is there a tool for this?"), candidate("2", "How do I do this?")];
    const scored = await scoreCandidates(shortlist, {
      provider: provider([
        { index: 0, relevance: 90, reasons: ["問題が一致"], intent: "seeking_solution", icpName: "", recommendedAction: "reply" },
        { index: 1, relevance: 80, reasons: [], intent: "question", icpName: "", recommendedAction: "reply" },
        { index: 7, relevance: 99, reasons: ["?"], intent: "question", icpName: "", recommendedAction: "reply" },
      ]),
      system: "",
      language: "en",
      icps: [],
    });
    expect(scored.map((s) => s.externalId)).toEqual(["1"]);
    expect(scored[0].icpName).toBeNull();
  });
});
