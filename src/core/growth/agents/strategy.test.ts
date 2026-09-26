import { describe, expect, it } from "vitest";

import { draftFromOutput, ensureFocusOnX, revisionFromOutput, type StrategyOutput, type StrategyRevisionOutput } from "./strategy-planner";

const output = (channels: StrategyOutput["channels"]): StrategyOutput => ({
  coreMessage: "自前運用をやめよう",
  supportingMessages: ["a", "a", "b"],
  pillars: [
    { name: "P1", share: 50, description: "d", postTypes: ["educational"] },
    { name: "P2", share: 30, description: "d", postTypes: ["build_in_public"] },
    { name: "P3", share: 30, description: "d", postTypes: ["comparison"] },
  ],
  channels,
  acquisition: ["a"],
  conversion: ["c"],
  retentionReferral: ["r"],
  rationale: "r",
});

describe("ensureFocusOnX", () => {
  it("makes X the only focus, whatever the model chose, and keeps the rest as later", () => {
    const channels = ensureFocusOnX([
      { name: "Reddit", role: "focus", rationale: "コミュニティ", startWhen: "" },
      { name: "X", role: "later", rationale: "ICPがいる", startWhen: "" },
      { name: "SEO", role: "later", rationale: "長期", startWhen: "登録が10件出たら" },
    ]);
    expect(channels.filter((c) => c.role === "focus").map((c) => c.name)).toEqual(["X"]);
    expect(channels.find((c) => c.name === "X")?.rationale).toBe("ICPがいる");
    expect(channels.filter((c) => c.role === "later").map((c) => c.name)).toEqual(["Reddit", "SEO"]);
  });

  it("adds X when the model left it out", () => {
    expect(ensureFocusOnX([{ name: "SEO", role: "later", rationale: "r", startWhen: "s" }])[0]).toMatchObject({ name: "X", role: "focus" });
  });
});

describe("draftFromOutput", () => {
  it("makes the pillars add up to 100 and the lists free of repeats", () => {
    const draft = draftFromOutput(output([]));
    expect(draft.pillars.reduce((s, p) => s + p.share, 0)).toBe(100);
    expect(draft.supportingMessages).toEqual(["a", "b"]);
  });
});

describe("revisionFromOutput", () => {
  const learnings = [
    { direction: "works" as const, statement: "痛みAが効く", explanation: "e" },
    { direction: "unclear" as const, statement: "形式Bは不明", explanation: "e" },
  ];
  const base: StrategyRevisionOutput = {
    coreMessage: "新しい中心",
    supportingMessages: ["s"],
    pillars: [{ name: "P", share: 100, description: "d", postTypes: ["educational"] }],
    acquisition: ["a"],
    changes: [],
    rationale: "r",
  };

  it("keeps only the changes a real, decided learning supports", () => {
    const revision = revisionFromOutput(
      {
        ...base,
        changes: [
          { what: "痛みAを厚く", because: "実験1", learningIndex: 0 },
          { what: "形式Bを厚く", because: "不明なのに", learningIndex: 1 },
          { what: "思いつき", because: "根拠なし", learningIndex: 9 },
        ],
      },
      learnings,
    );
    expect(revision?.changes).toEqual([{ what: "痛みAを厚く", because: "実験1" }]);
  });

  it("is no revision at all when nothing is supported", () => {
    expect(revisionFromOutput({ ...base, changes: [{ what: "x", because: "y", learningIndex: 5 }] }, learnings)).toBeNull();
  });
});
