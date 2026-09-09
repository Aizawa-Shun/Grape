import { eq, sql } from "drizzle-orm";

import { DEFAULT_WINDOW_DAYS } from "@/core/intelligence/outcomes";
import { db, schema, type Database } from "@/db/client";
import type { Channel, DiagnosisMode, FunnelStage, TaskStatus } from "@/db/schema";

/**
 * What one person should do next, across everything they have registered.
 *
 * Decided in code, not by a model — same rule as the funnel. "Which of these
 * nine states am I in" is a question with a right answer, and asking a model
 * would make the one thing the dashboard promises non-deterministic.
 *
 * The order is by what is actually waiting on the person. A draft awaiting
 * approval sits at the top because it is a decision only they can make, and on
 * the X channel it costs real money; setup that merely improves future data
 * sits at the bottom, because Grape works without it — the cold-start audit
 * needs no traffic at all.
 */

const DIAGNOSIS_STALE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StepProduct {
  id: string;
  name: string;
  url: string;
}

export interface StepTask {
  id: string;
  title: string;
}

export type NextStep =
  | { kind: "register" }
  | { kind: "review_task"; product: StepProduct; task: StepTask }
  | { kind: "measure_outcome"; product: StepProduct; task: StepTask }
  | { kind: "generate_artifact"; product: StepProduct; task: StepTask }
  | { kind: "verify_context"; product: StepProduct }
  | { kind: "run_diagnosis"; product: StepProduct; reason: "never" | "stale" }
  | { kind: "install_snippet"; product: StepProduct }
  | { kind: "set_key_event"; product: StepProduct }
  | { kind: "waiting"; product: StepProduct; task: StepTask; readyAt: Date }
  | { kind: "idle"; product: StepProduct };

export interface TaskOutcome {
  before: number;
  after: number;
  delta: number;
  windowDays: number;
  evaluatedAt: Date;
}

export interface TaskSnapshot {
  id: string;
  title: string;
  status: TaskStatus;
  stage: FunnelStage;
  channel: Channel;
  completedAt: Date | null;
  hasArtifact: boolean;
  /** The measured result, kept whole so the briefing can celebrate a good one. */
  outcome: TaskOutcome | null;
}

export interface ProductSnapshot {
  product: StepProduct;
  keyEventName: string | null;
  eventCount: number;
  /** null when no Product Context exists at all. */
  contextEditedByHuman: boolean | null;
  latestDiagnosisAt: Date | null;
  /** "audit" means it was decided from the site itself, for want of traffic. */
  latestDiagnosisMode: DiagnosisMode | null;
  latestBottleneckStage: FunnelStage | null;
  tasks: TaskSnapshot[];
}

/** Lower sorts first. Kept as data so the ordering is one readable list. */
const PRIORITY: Record<NextStep["kind"], number> = {
  register: 0,
  review_task: 1,
  measure_outcome: 2,
  generate_artifact: 3,
  verify_context: 4,
  run_diagnosis: 5,
  install_snippet: 6,
  set_key_event: 7,
  waiting: 8,
  idle: 9,
};

export function pickNextStep(snapshots: ProductSnapshot[], now: Date = new Date()): NextStep {
  if (snapshots.length === 0) return { kind: "register" };

  const candidates = snapshots.map((snapshot) => stepFor(snapshot, now));
  // Ties keep the input order, which is registration order — stable, so the
  // headline does not shuffle between refreshes.
  return candidates.reduce((best, candidate) =>
    PRIORITY[candidate.kind] < PRIORITY[best.kind] ? candidate : best,
  );
}

function stepFor(snapshot: ProductSnapshot, now: Date): NextStep {
  const { product, tasks } = snapshot;

  const open = tasks.filter((task) => task.status !== "done" && task.status !== "skipped");

  const awaitingApproval = open.find((task) => task.hasArtifact);
  if (awaitingApproval) {
    return { kind: "review_task", product, task: brief(awaitingApproval) };
  }

  const measurable = tasks.find(
    (task) =>
      task.status === "done" &&
      task.outcome === null &&
      task.completedAt !== null &&
      now.getTime() - task.completedAt.getTime() >= DEFAULT_WINDOW_DAYS * DAY_MS,
  );
  if (measurable) return { kind: "measure_outcome", product, task: brief(measurable) };

  const needsDraft = open[0];
  if (needsDraft) return { kind: "generate_artifact", product, task: brief(needsDraft) };

  if (snapshot.contextEditedByHuman === false) return { kind: "verify_context", product };

  if (!snapshot.latestDiagnosisAt) return { kind: "run_diagnosis", product, reason: "never" };
  if (now.getTime() - snapshot.latestDiagnosisAt.getTime() >= DIAGNOSIS_STALE_DAYS * DAY_MS) {
    return { kind: "run_diagnosis", product, reason: "stale" };
  }

  // Below here the loop is up to date and what is left only improves the data
  // the *next* round will have.
  if (snapshot.eventCount === 0) return { kind: "install_snippet", product };
  if (!snapshot.keyEventName) return { kind: "set_key_event", product };

  const pending = tasks
    .filter((task) => task.status === "done" && task.outcome === null && task.completedAt !== null)
    .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime())[0];
  if (pending) {
    return {
      kind: "waiting",
      product,
      task: brief(pending),
      readyAt: new Date(pending.completedAt!.getTime() + DEFAULT_WINDOW_DAYS * DAY_MS),
    };
  }

  return { kind: "idle", product };
}

function brief(task: TaskSnapshot): StepTask {
  return { id: task.id, title: task.title };
}

/** Reads what pickNextStep needs. Separate so the decision itself stays pure. */
export async function loadSnapshots(
  userId: string,
  database?: Database,
): Promise<ProductSnapshot[]> {
  const conn = database ?? db;

  // Required rather than optional, for the same reason as loadNavProducts:
  // this returns a list, and whose list it is cannot be an afterthought.
  const products = await conn.query.products.findMany({
    where: eq(schema.products.userId, userId),
    orderBy: (products, { asc }) => [asc(products.createdAt)],
  });

  return Promise.all(
    products.map(async (product) => {
      const [events] = await conn
        .select({ n: sql<number>`count(*)` })
        .from(schema.events)
        .where(eq(schema.events.productId, product.id));

      const context = await conn.query.productContexts.findFirst({
        where: eq(schema.productContexts.productId, product.id),
        orderBy: (contexts, { desc }) => [desc(contexts.version)],
        columns: { editedByHuman: true },
      });

      const diagnosis = await conn.query.diagnoses.findFirst({
        where: eq(schema.diagnoses.productId, product.id),
        orderBy: (diagnoses, { desc }) => [desc(diagnoses.createdAt)],
        columns: { createdAt: true, mode: true, bottleneckStage: true },
      });

      const tasks = await conn.query.tasks.findMany({
        where: eq(schema.tasks.productId, product.id),
        orderBy: (tasks, { desc }) => [desc(tasks.impact)],
      });

      const withState = await Promise.all(
        tasks.map(async (task) => {
          const artifact = await conn.query.artifacts.findFirst({
            where: eq(schema.artifacts.taskId, task.id),
            columns: { id: true },
          });
          const outcome = await conn.query.outcomes.findFirst({
            where: eq(schema.outcomes.taskId, task.id),
            orderBy: (outcomes, { desc }) => [desc(outcomes.evaluatedAt)],
          });
          return {
            id: task.id,
            title: task.title,
            status: task.status,
            stage: task.stage,
            channel: task.channel,
            completedAt: task.completedAt,
            hasArtifact: artifact !== undefined,
            outcome: outcome
              ? {
                  before: outcome.before,
                  after: outcome.after,
                  delta: outcome.delta,
                  windowDays: outcome.windowDays,
                  evaluatedAt: outcome.evaluatedAt,
                }
              : null,
          } satisfies TaskSnapshot;
        }),
      );

      return {
        product: { id: product.id, name: product.name, url: product.url },
        keyEventName: product.keyEventName,
        eventCount: Number(events?.n ?? 0),
        contextEditedByHuman: context ? context.editedByHuman : null,
        latestDiagnosisAt: diagnosis?.createdAt ?? null,
        latestDiagnosisMode: diagnosis?.mode ?? null,
        latestBottleneckStage: diagnosis?.bottleneckStage ?? null,
        tasks: withState,
      } satisfies ProductSnapshot;
    }),
  );
}
