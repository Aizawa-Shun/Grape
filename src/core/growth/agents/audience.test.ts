import { describe, expect, it } from "vitest";

import type { Fact, Segment } from "@/db/schema";

import { confidenceFor, segmentsFromOutput, type AudienceOutput } from "./audience-analyzer";
import { positioningFromOutput, type PositioningInput } from "./positioning-analyzer";

const insights = [
  { id: "i0", kind: "pain" as const, statement: "a", userPhrases: [], grounded: true },
  { id: "i1", kind: "pain" as const, statement: "b", userPhrases: [], grounded: true },
  { id: "i2", kind: "trend" as const, statement: "c", userPhrases: [], grounded: false },
  { id: "i3", kind: "pain" as const, statement: "d", userPhrases: [], grounded: true },
];

const segment = (evidence: number[]): AudienceOutput["segments"][number] => ({
  name: "個人開発者",
  role: "r",
  companySize: "1人",
  technicalLevel: "高い",
  situation: "s",
  problem: "p",
  pain: "pa",
  motivation: "m",
  currentSolutions: ["X", "X"],
  fitReason: "f",
  channels: ["X"],
  keywords: ["k"],
  xPhrases: ["x"],
  evidence,
});

describe("segmentsFromOutput", () => {
  it("counts a segment's confidence from the real sources behind it, not from the model", () => {
    const [strong, weak, none] = segmentsFromOutput({ segments: [segment([0, 1, 3]), segment([2, 0]), segment([9])] }, insights);
    expect(strong.confidence).toBe("high");
    expect(strong.evidence).toEqual(["i0", "i1", "i3"]);
    expect(weak.confidence).toBe("medium");
    // A number that names no finding cites nothing.
    expect(none).toMatchObject({ confidence: "low", evidence: [] });
  });

  it("starts every segment as a hypothesis and de-duplicates its lists", () => {
    const [s] = segmentsFromOutput({ segments: [segment([0])] }, insights);
    expect(s.status).toBe("hypothesis");
    expect(s.currentSolutions).toEqual(["X"]);
  });

  it("scores confidence on grounded findings only", () => {
    expect(confidenceFor([{ grounded: false }, { grounded: false }])).toBe("low");
  });
});

describe("positioningFromOutput", () => {
  const known: Fact = { text: "成功した分だけ課金", status: "known", basis: "site", evidence: [] };
  const assumed: Fact = { text: "高速である", status: "assumption", basis: "inference", evidence: [] };
  const input: PositioningInput = {
    segment: { id: "s1", name: "個人開発者", role: "r", situation: "s", problem: "p", pain: "pa", motivation: "m", currentSolutions: [] } as Pick<Segment, "id" | "name" | "role" | "situation" | "problem" | "pain" | "motivation" | "currentSolutions">,
    differentiators: [known, assumed],
    proof: [{ text: "3,800人が使用", status: "known", basis: "site", evidence: [] }],
    competitors: [],
    gaps: [],
  };
  const output = { oneLiner: "o", forWhom: "f", problem: "p", product: "p", alternatives: ["自前運用"], becauseFacts: [0, 1, 2] };

  it("reads each reason's status back from the fact it points at", () => {
    expect(positioningFromOutput(output, input).because).toEqual([
      { text: "成功した分だけ課金", status: "known" },
      { text: "高速である", status: "assumption" },
      { text: "3,800人が使用", status: "known" },
    ]);
  });

  it("cannot invent a reason: an index that names nothing falls back to something known", () => {
    expect(positioningFromOutput({ ...output, becauseFacts: [42] }, input).because).toEqual([{ text: "成功した分だけ課金", status: "known" }]);
  });
});
