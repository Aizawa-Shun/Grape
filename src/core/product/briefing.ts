import { STAGE_UI } from "@/core/data/stages";
import type { FunnelStage } from "@/db/schema";

import { pickNextStep, type NextStep, type ProductSnapshot, type TaskSnapshot } from "./next-step";

/**
 * What the home page says, in three parts: where things stand, anything worth
 * celebrating, and at most one thing to do.
 *
 * Not a to-do list. Someone opening this has minutes, not an afternoon, and a
 * list would make them choose before they can act — so the ranking already
 * happened in next-step.ts and this only frames it.
 *
 * The celebration is not decoration. This is a tool whose whole promise is
 * that effort moves a number, and the moment that actually happens is the only
 * evidence the promise was kept; leaving it unsaid wastes the one thing that
 * makes the next week's work feel worth starting.
 */

/** The six situations, in the order someone passes through them. */
export type Situation =
  | "unregistered"
  | "before_diagnosis"
  | "cold_start"
  | "diagnosed"
  | "awaiting_outcome"
  | "all_clear";

export interface Celebration {
  taskTitle: string;
  stage: FunnelStage;
  before: number;
  after: number;
  delta: number;
  windowDays: number;
}

export interface Briefing {
  situation: Situation;
  /** One sentence. Read first, and sometimes the only thing read. */
  headline: string;
  celebration: Celebration | null;
  step: NextStep;
}

/** Recent enough that the reader still connects it to what they did. */
const CELEBRATE_WITHIN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export function buildBriefing(snapshots: ProductSnapshot[], now: Date = new Date()): Briefing {
  const step = pickNextStep(snapshots, now);

  // The briefing describes the product the suggestion is about, so the two
  // halves of the page cannot end up talking about different things.
  const focus =
    "product" in step
      ? (snapshots.find((s) => s.product.id === step.product.id) ?? null)
      : null;

  const situation = situationOf(focus);

  return {
    situation,
    headline: headlineFor(situation, focus),
    celebration: focus ? findCelebration(focus.tasks, now) : null,
    step,
  };
}

function situationOf(snapshot: ProductSnapshot | null): Situation {
  if (!snapshot) return "unregistered";

  if (!snapshot.latestDiagnosisAt) return "before_diagnosis";
  if (snapshot.latestDiagnosisMode === "audit") return "cold_start";

  const open = snapshot.tasks.filter(
    (task) => task.status !== "done" && task.status !== "skipped",
  );
  if (open.length > 0) return "diagnosed";

  const awaiting = snapshot.tasks.some((task) => task.status === "done" && task.outcome === null);
  if (awaiting) return "awaiting_outcome";

  return "all_clear";
}

function headlineFor(situation: Situation, snapshot: ProductSnapshot | null): string {
  switch (situation) {
    case "unregistered":
      return "まだ何も登録されていません。";
    case "before_diagnosis":
      return "まだ調べていません。人が来ていなくても始められます。";
    case "cold_start":
      return "まだ来ている人が少ないので、サイトの中身から判断しています。";
    case "diagnosed": {
      const stage = snapshot?.latestBottleneckStage;
      return stage
        ? `いま一番の問題は「${STAGE_UI[stage].label}」の段階です。`
        : "調べ終わっています。やることが出ています。";
    }
    case "awaiting_outcome":
      return "やったことの効果が出るのを待っています。";
    case "all_clear":
      return "いまのところ、手を打つべき問題は出ていません。";
  }
}

/**
 * The most recently measured task that actually moved in the right direction.
 *
 * Only counts a real gain: reporting "0人 → 0人" as good news would teach the
 * reader to stop believing this section, which costs more than staying quiet.
 */
function findCelebration(tasks: TaskSnapshot[], now: Date): Celebration | null {
  const won = tasks
    .filter(
      (task): task is TaskSnapshot & { outcome: NonNullable<TaskSnapshot["outcome"]> } =>
        task.outcome !== null &&
        task.outcome.delta > 0 &&
        now.getTime() - task.outcome.evaluatedAt.getTime() <= CELEBRATE_WITHIN_DAYS * DAY_MS,
    )
    .sort((a, b) => b.outcome.evaluatedAt.getTime() - a.outcome.evaluatedAt.getTime());

  const best = won[0];
  if (!best) return null;

  return {
    taskTitle: best.title,
    stage: best.stage,
    before: best.outcome.before,
    after: best.outcome.after,
    delta: best.outcome.delta,
    windowDays: best.outcome.windowDays,
  };
}
