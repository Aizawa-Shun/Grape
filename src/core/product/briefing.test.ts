import { describe, expect, it } from "vitest";

import { buildBriefing } from "./briefing";
import type { ProductSnapshot, TaskSnapshot } from "./next-step";

const NOW = new Date("2026-06-15T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function task(overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    id: "t1",
    title: "OGP画像を用意する",
    status: "proposed",
    stage: "reach",
    channel: "manual",
    completedAt: null,
    hasArtifact: false,
    outcome: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    product: { id: "p1", name: "Chess", url: "https://chess.example" },
    keyEventName: "signup",
    eventCount: 100,
    contextEditedByHuman: true,
    latestDiagnosisAt: daysAgo(1),
    latestDiagnosisMode: "funnel",
    latestBottleneckStage: "engage",
    tasks: [],
    ...overrides,
  };
}

const measured = (delta: number, evaluatedAt: Date) =>
  task({
    id: "done-1",
    title: "OGP画像を用意する",
    status: "done",
    stage: "engage",
    completedAt: daysAgo(10),
    hasArtifact: true,
    outcome: { before: 20, after: 20 + delta, delta, windowDays: 7, evaluatedAt },
  });

describe("buildBriefing — the six situations", () => {
  it("says nothing is registered when nothing is", () => {
    const briefing = buildBriefing([], NOW);

    expect(briefing.situation).toBe("unregistered");
    expect(briefing.step.kind).toBe("register");
  });

  it("distinguishes not having looked yet", () => {
    const briefing = buildBriefing([snapshot({ latestDiagnosisAt: null })], NOW);

    expect(briefing.situation).toBe("before_diagnosis");
    // The reassurance matters: with no traffic, people assume it is too early.
    expect(briefing.headline).toContain("人が来ていなくても");
  });

  it("says so plainly when the finding came from the site rather than the numbers", () => {
    const briefing = buildBriefing([snapshot({ latestDiagnosisMode: "audit" })], NOW);

    expect(briefing.situation).toBe("cold_start");
    expect(briefing.headline).toContain("サイトの中身から");
  });

  it("names the blamed stage in plain Japanese once there is a real diagnosis", () => {
    const briefing = buildBriefing(
      [snapshot({ latestBottleneckStage: "engage", tasks: [task()] })],
      NOW,
    );

    expect(briefing.situation).toBe("diagnosed");
    expect(briefing.headline).toContain("中身を見てもらう");
    expect(briefing.headline).not.toContain("engage");
  });

  it("separates waiting for a result from having nothing to do", () => {
    const waiting = buildBriefing(
      [snapshot({ tasks: [task({ status: "done", completedAt: daysAgo(2) })] })],
      NOW,
    );
    expect(waiting.situation).toBe("awaiting_outcome");

    const clear = buildBriefing([snapshot({ tasks: [measured(5, daysAgo(1))] })], NOW);
    expect(clear.situation).toBe("all_clear");
  });

  it("ignores skipped tasks when deciding whether anything is outstanding", () => {
    const briefing = buildBriefing([snapshot({ tasks: [task({ status: "skipped" })] })], NOW);

    expect(briefing.situation).toBe("all_clear");
  });
});

describe("buildBriefing — celebrating", () => {
  it("celebrates a task that actually moved the number", () => {
    const briefing = buildBriefing([snapshot({ tasks: [measured(14, daysAgo(1))] })], NOW);

    expect(briefing.celebration).toMatchObject({
      taskTitle: "OGP画像を用意する",
      delta: 14,
      before: 20,
      after: 34,
    });
  });

  it("stays quiet when the number did not move, rather than dressing it up", () => {
    expect(buildBriefing([snapshot({ tasks: [measured(0, daysAgo(1))] })], NOW).celebration).toBeNull();
    expect(buildBriefing([snapshot({ tasks: [measured(-3, daysAgo(1))] })], NOW).celebration).toBeNull();
  });

  it("stops celebrating something too old to connect to what was done", () => {
    const briefing = buildBriefing([snapshot({ tasks: [measured(14, daysAgo(30))] })], NOW);

    expect(briefing.celebration).toBeNull();
  });

  it("picks the most recently measured win when there are several", () => {
    const briefing = buildBriefing(
      [
        snapshot({
          tasks: [
            { ...measured(4, daysAgo(9)), id: "old", title: "古いほう" },
            { ...measured(9, daysAgo(2)), id: "new", title: "新しいほう" },
          ],
        }),
      ],
      NOW,
    );

    expect(briefing.celebration?.taskTitle).toBe("新しいほう");
  });
});

describe("buildBriefing — coherence", () => {
  it("describes the same product the suggestion is about, not a different one", () => {
    const quiet = snapshot({
      product: { id: "p1", name: "Quiet", url: "https://a.example" },
      latestDiagnosisMode: "audit",
    });
    const urgent = snapshot({
      product: { id: "p2", name: "Urgent", url: "https://b.example" },
      latestDiagnosisMode: "funnel",
      latestBottleneckStage: "activate",
      tasks: [task({ hasArtifact: true })],
    });

    const briefing = buildBriefing([quiet, urgent], NOW);

    expect(briefing.step).toMatchObject({ kind: "review_task", product: { id: "p2" } });
    // Not the cold-start line belonging to the other product.
    expect(briefing.situation).toBe("diagnosed");
    expect(briefing.headline).toContain("使ってもらう");
  });
});
