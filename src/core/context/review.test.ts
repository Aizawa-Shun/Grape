import { describe, expect, it } from "vitest";

import type { SaasAnalysis } from "./analysis";
import { draftNotesFor, editableValue } from "./review";
import { UNSTATED } from "./unstated";

const filled = { what: "チェスを遊べる", who: "初心者", why: "相手がいない", how: "開いて対局する" };

function analysis(statuses: { what?: string; who?: string; problems?: string; usage?: string }) {
  const claim = (status = "confirmed") => ({ value: "v", items: ["i"], status });
  return {
    service: {
      what: claim(statuses.what),
      who: claim(statuses.who),
      problems: claim(statuses.problems),
      valueProposition: claim(),
      features: claim(),
      usage: claim(statuses.usage),
    },
  } as unknown as SaasAnalysis;
}

describe("draftNotesFor", () => {
  it("flags the fields a model filled in without the site saying so", () => {
    const notes = draftNotesFor(filled, analysis({ who: "unknown", problems: "unknown" }), false);

    expect(notes).toEqual({ source: "ai", blank: [], guessed: ["who", "why"] });
  });

  it("does not flag an inference — only what the site gave no footing for", () => {
    expect(draftNotesFor(filled, analysis({ who: "inferred" }), false).guessed).toEqual([]);
  });

  it("lists what the rule-based reading could not find as blank", () => {
    const notes = draftNotesFor({ ...filled, who: UNSTATED, why: UNSTATED }, null, false);

    expect(notes).toEqual({ source: "rules", blank: ["who", "why"], guessed: [] });
  });

  it("has nothing to warn about once a person has confirmed the fields", () => {
    expect(draftNotesFor(filled, analysis({ who: "unknown" }), true)).toEqual({
      source: "human",
      blank: [],
      guessed: [],
    });
  });
});

describe("editableValue", () => {
  it("starts an unstated field empty instead of showing the sentinel sentence", () => {
    expect(editableValue(UNSTATED)).toBe("");
    expect(editableValue("初心者")).toBe("初心者");
  });
});
