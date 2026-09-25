import { describe, expect, it } from "vitest";

import { AppError } from "@/core/errors";
import { createMemoryStore } from "@/db/store/memory";

import { advanceRun, claimNextStep, createRun, driveRun, RUN_LEASE_MS, StepSkipped, type StepExecutor } from "./runs";

async function setup(steps: ("market" | "icp" | "strategy")[] = ["market", "icp", "strategy"]) {
  const conn = createMemoryStore();
  const { run } = await createRun({ productId: "p1", userId: "u1", kind: "manual", steps }, conn);
  return { conn, run };
}

describe("createRun", () => {
  it("returns the run already going instead of starting a second", async () => {
    const { conn, run } = await setup();
    const again = await createRun({ productId: "p1", userId: "u1", kind: "manual", steps: ["market"] }, conn);
    expect(again.created).toBe(false);
    expect(again.run.id).toBe(run.id);
  });
});

describe("claimNextStep", () => {
  it("lets only one request hold a run at a time, until the lease runs out", async () => {
    const { conn, run } = await setup();
    const now = new Date();
    expect(await claimNextStep(run.id, conn, now)).not.toBeNull();
    expect(await claimNextStep(run.id, conn, now)).toBeNull();
    // The request that held it died: the step is taken again once the lease expires.
    const later = await claimNextStep(run.id, conn, new Date(now.getTime() + RUN_LEASE_MS + 1));
    expect(later?.index).toBe(0);
    expect(later?.run.steps[0].attempts).toBe(2);
  });
});

describe("advanceRun", () => {
  it("runs steps in order and completes the run", async () => {
    const { conn, run } = await setup();
    const seen: string[] = [];
    const execute: StepExecutor = async (_run, step) => {
      seen.push(step.kind);
      return `${step.kind} done`;
    };
    const finished = await driveRun(run.id, execute, 10_000, conn);
    expect(seen).toEqual(["market", "icp", "strategy"]);
    expect(finished?.status).toBe("completed");
    expect(finished?.steps.every((s) => s.status === "completed")).toBe(true);
    expect((await conn.agentActions.find()).length).toBe(3);
  });

  /** Spec §31: one failing source must not take the run down with it. */
  it("retries a failed step once, then records it and carries on", async () => {
    const { conn, run } = await setup();
    const execute: StepExecutor = async (_run, step) => {
      if (step.kind === "market") throw new Error("search timed out");
      return "ok";
    };
    const finished = await driveRun(run.id, execute, 10_000, conn);
    const market = finished!.steps[0];
    expect(market.status).toBe("failed");
    expect(market.attempts).toBe(2);
    expect(market.error).toBeTruthy();
    expect(finished!.steps.slice(1).every((s) => s.status === "completed")).toBe(true);
    expect(finished!.status).toBe("completed");
  });

  it("does not retry what a retry cannot fix", async () => {
    const { conn, run } = await setup(["market"]);
    const execute: StepExecutor = async () => {
      throw new AppError("LLM_NOT_CONFIGURED", "no key", { hint: "APIキーを設定してください。" });
    };
    const after = await advanceRun(run.id, execute, conn);
    expect(after!.steps[0]).toMatchObject({ status: "failed", attempts: 1, error: expect.stringContaining("APIキー") });
    expect(after!.status).toBe("failed");
  });

  it("records a step with nothing to do as skipped, not failed", async () => {
    const { conn, run } = await setup(["market"]);
    const after = await advanceRun(run.id, async () => {
      throw new StepSkipped("nothing yet");
    }, conn);
    expect(after!.steps[0]).toMatchObject({ status: "skipped", summary: "nothing yet" });
    expect(after!.status).toBe("completed");
  });
});
