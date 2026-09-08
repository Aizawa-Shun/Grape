import { describe, expect, it } from "vitest";

import { pickNextStep, type ProductSnapshot, type TaskSnapshot } from "./next-step";

const NOW = new Date("2026-06-15T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function task(overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    id: "t1",
    title: "OGP画像を用意する",
    status: "proposed",
    channel: "manual",
    completedAt: null,
    hasArtifact: false,
    hasOutcome: false,
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
    tasks: [],
    ...overrides,
  };
}

describe("pickNextStep", () => {
  it("asks for a product when there is nothing to work on at all", () => {
    expect(pickNextStep([], NOW)).toEqual({ kind: "register" });
  });

  it("puts a draft awaiting approval above everything else", () => {
    const step = pickNextStep(
      [
        snapshot({
          contextEditedByHuman: false,
          eventCount: 0,
          keyEventName: null,
          latestDiagnosisAt: null,
          tasks: [task({ hasArtifact: true })],
        }),
      ],
      NOW,
    );

    // Every other condition is also unmet here; the decision waiting on a
    // human still wins.
    expect(step.kind).toBe("review_task");
  });

  it("offers to measure a task once its window has actually elapsed", () => {
    const step = pickNextStep(
      [snapshot({ tasks: [task({ status: "done", completedAt: daysAgo(8) })] })],
      NOW,
    );

    expect(step).toMatchObject({ kind: "measure_outcome", task: { id: "t1" } });
  });

  it("waits, rather than offering to measure, before the window is up", () => {
    const step = pickNextStep(
      [snapshot({ tasks: [task({ status: "done", completedAt: daysAgo(2) })] })],
      NOW,
    );

    expect(step).toMatchObject({ kind: "waiting" });
    if (step.kind === "waiting") {
      expect(step.readyAt.toISOString()).toBe("2026-06-20T00:00:00.000Z");
    }
  });

  it("does not offer to measure a task that was already measured", () => {
    const step = pickNextStep(
      [snapshot({ tasks: [task({ status: "done", completedAt: daysAgo(30), hasOutcome: true })] })],
      NOW,
    );

    expect(step.kind).toBe("idle");
  });

  it("ignores skipped tasks entirely", () => {
    const step = pickNextStep([snapshot({ tasks: [task({ status: "skipped" })] })], NOW);

    expect(step.kind).toBe("idle");
  });

  it("asks for a draft when a task has none", () => {
    const step = pickNextStep([snapshot({ tasks: [task()] })], NOW);

    expect(step).toMatchObject({ kind: "generate_artifact", task: { id: "t1" } });
  });

  it("asks to check an auto-written context before running on it", () => {
    const step = pickNextStep(
      [snapshot({ contextEditedByHuman: false, latestDiagnosisAt: null })],
      NOW,
    );

    expect(step.kind).toBe("verify_context");
  });

  it("distinguishes never diagnosed from a diagnosis that has gone stale", () => {
    expect(pickNextStep([snapshot({ latestDiagnosisAt: null })], NOW)).toMatchObject({
      kind: "run_diagnosis",
      reason: "never",
    });
    expect(pickNextStep([snapshot({ latestDiagnosisAt: daysAgo(8) })], NOW)).toMatchObject({
      kind: "run_diagnosis",
      reason: "stale",
    });
  });

  it("only mentions setup once the loop itself is up to date", () => {
    // With no events and no diagnosis, running the diagnosis still comes
    // first: the cold-start audit needs no traffic to say something useful.
    expect(
      pickNextStep([snapshot({ eventCount: 0, latestDiagnosisAt: null })], NOW).kind,
    ).toBe("run_diagnosis");

    expect(pickNextStep([snapshot({ eventCount: 0 })], NOW).kind).toBe("install_snippet");
    expect(pickNextStep([snapshot({ keyEventName: null })], NOW).kind).toBe("set_key_event");
  });

  it("picks the most urgent product across all of them, not the first", () => {
    const quiet = snapshot({ product: { id: "p1", name: "Quiet", url: "https://a.example" } });
    const urgent = snapshot({
      product: { id: "p2", name: "Urgent", url: "https://b.example" },
      tasks: [task({ hasArtifact: true })],
    });

    const step = pickNextStep([quiet, urgent], NOW);

    expect(step).toMatchObject({ kind: "review_task", product: { id: "p2" } });
  });

  it("keeps registration order when two products want the same thing", () => {
    const first = snapshot({ product: { id: "p1", name: "First", url: "https://a.example" } });
    const second = snapshot({ product: { id: "p2", name: "Second", url: "https://b.example" } });

    expect(pickNextStep([first, second], NOW)).toMatchObject({ product: { id: "p1" } });
  });
});
