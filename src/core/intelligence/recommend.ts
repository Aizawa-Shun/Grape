import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { renderContextSnapshot } from "@/core/context/snapshot";
import { AppError } from "@/core/errors";
import { getProvider, type LLMProvider } from "@/core/llm";
import { db, schema, type Database } from "@/db/client";
import type { Channel } from "@/db/schema";

import type { Diagnosis } from "./diagnose";

/**
 * Turns a diagnosis into the concrete, doable tasks for the coming week.
 *
 * Deliberately generates against the context version the diagnosis actually
 * reasoned over (`diagnosis.contextVersion`), not whatever the latest version
 * happens to be now — a human could have edited Context in between, and a
 * task justified by "the diagnosis found X" has to stay attached to the X
 * that was true when it was written, or the rationale stops making sense.
 */

/** Rescues a rating a small model answers on the wrong scale (e.g. 0-10, or a float) into a clean 1-5 integer. */
function boundedRating() {
  return z.preprocess((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return value;
    const scaled = value > 5 ? Math.round((value / 10) * 5) : Math.round(value);
    return Math.min(5, Math.max(1, scaled));
  }, z.number().int().min(1).max(5));
}

const TaskSuggestionSchema = z.object({
  title: z.string().min(1).describe("今週やること。1文、動詞で始める。"),
  rationale: z
    .string()
    .min(1)
    .describe("なぜこのタスクが今のボトルネックに効くのか。診断結果とProduct Contextを根拠にする。"),
  expectedMetric: z.string().min(1).describe("このタスクが動かす指標。例: 'Engageのセッション数'"),
  expectedDirection: z.enum(["up", "down"]).describe("その指標が良くなる向き。通常は up。"),
  impact: boundedRating().describe("効いた場合のインパクト。1(小)〜5(大)の整数。"),
  effort: boundedRating().describe("かかる労力。1(小)〜5(大)の整数。"),
  channel: z
    .enum(["manual", "x"])
    .describe("実行方法。プロダクト自体の変更やLPの修正は 'manual'。SNSでの発信は 'x'。"),
});

const TaskSuggestionsSchema = z.object({
  tasks: z.array(TaskSuggestionSchema).min(1).max(3).describe("今週取り組むタスク。多すぎても実行されないので最大3件。"),
});

const RECOMMEND_SYSTEM_SUFFIX = `

あなたは上記プロダクトの成長担当です。直前の診断で特定されたボトルネックに対して、
今週1週間で実行できる具体的なタスクを1〜3件提案してください。

厳守すること:
1. ボトルネックの段階を動かすタスクにする。無関係な改善提案をしない。
2. 個人開発者が一人で、今週中に着手できる粒度にする。大規模な作り直しを提案しない。
3. Product Contextに書かれた製品の実態に沿う。書かれていない機能があるかのように書かない。
4. 出力は日本語で書く。`;

function isoWeekString(date: Date): string {
  // ISO 8601 week: Thursday of the week decides which year the week belongs
  // to, which is what keeps the last days of December from being mislabeled
  // into next year's week 1 or vice versa.
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export { isoWeekString };

export type Task = typeof schema.tasks.$inferSelect;

export interface RecommendOptions {
  provider?: LLMProvider;
  now?: Date;
  database?: Database;
}

export async function recommendTasks(diagnosis: Diagnosis, options: RecommendOptions = {}): Promise<Task[]> {
  const conn = options.database ?? db;
  const provider = options.provider ?? getProvider();
  const now = options.now ?? new Date();

  const product = await conn.query.products.findFirst({ where: eq(schema.products.id, diagnosis.productId) });
  if (!product) throw new AppError("NOT_FOUND", `Unknown product: ${diagnosis.productId}`);

  const contextVersion = await conn.query.productContexts.findFirst({
    where: and(
      eq(schema.productContexts.productId, diagnosis.productId),
      eq(schema.productContexts.version, diagnosis.contextVersion),
    ),
  });

  if (!contextVersion) {
    throw new AppError(
      "CONFLICT",
      `Product ${diagnosis.productId} has no Product Context v${diagnosis.contextVersion} (the version diagnosis ${diagnosis.id} reasoned over)`,
    );
  }

  const userPrompt = [
    `# 診断結果 (${diagnosis.mode === "audit" ? "サイト監査" : "ファネル"})`,
    `ボトルネック: ${diagnosis.bottleneckStage}`,
    "",
    diagnosis.summary,
  ].join("\n");

  const { value } = await provider.completeStructured({
    kind: "generate",
    schemaName: "task_suggestions",
    schema: TaskSuggestionsSchema,
    system: renderContextSnapshot(product, contextVersion) + RECOMMEND_SYSTEM_SUFFIX,
    user: userPrompt,
  });

  const dueWeek = isoWeekString(now);

  const rows = value.tasks.map((task) => ({
    productId: diagnosis.productId,
    diagnosisId: diagnosis.id,
    title: task.title,
    rationale: task.rationale,
    stage: diagnosis.bottleneckStage,
    channel: task.channel as Channel,
    expectedMetric: task.expectedMetric,
    expectedDirection: task.expectedDirection,
    impact: task.impact,
    effort: task.effort,
    dueWeek,
  }));

  return conn.insert(schema.tasks).values(rows).returning();
}
