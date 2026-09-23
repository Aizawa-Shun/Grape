import { eq } from "drizzle-orm";
import { z } from "zod";

import { renderContextSnapshot } from "@/core/context/snapshot";
import { AppError, toAppError } from "@/core/errors";
import { getFunnel, type FunnelResult } from "@/core/data/funnel";
import { STAGE_UI } from "@/core/data/stages";
import { getProvider, type LLMProvider } from "@/core/llm";
import { db, schema, type Database } from "@/db/client";
import type { FunnelStage } from "@/db/schema";

import { runSiteAudit, type AuditFinding } from "./audit";
import { getRecentOutcomes, type PastOutcome } from "./outcomes";

/**
 * Turns this week's funnel (or, cold-start, a site audit) plus the Product
 * Context into one persisted diagnosis: which stage is the bottleneck, and
 * why.
 *
 * The split enforced throughout this codebase applies here too: *which*
 * stage is the bottleneck is arithmetic, decided by funnel.ts before this
 * module ever runs a prompt. The LLM's only job is the "why" — reading the
 * numbers against What/Who/Why/How and writing the explanation a human
 * actually needs. It cannot talk Grape into blaming a different stage; there
 * is no field in its output for that.
 */

const DiagnosisNarrativeSchema = z.object({
  summary: z
    .string()
    .describe(
      "診断結果の要約。2〜4文。与えられた数値とProduct Contextだけを根拠にし、断定できないことは断定しない。",
    ),
  /** Same 0-100 rescue as extract.ts — small local models answer on that scale regardless of the schema. */
  confidence: z
    .preprocess(
      (value) => (typeof value === "number" && value > 1 && value <= 100 ? value / 100 : value),
      z.number().min(0).max(1),
    )
    .describe("この説明の確信度。0〜1の小数。"),
});

export type Diagnosis = typeof schema.diagnoses.$inferSelect;

const DIAGNOSE_SYSTEM_SUFFIX = `

あなたは上記プロダクトの成長を担当するアナリストです。与えられたファネルの数値、
またはサイト監査の結果をもとに、今どこがボトルネックかを「なぜそうなっているか」
説明してください。

厳守すること:
1. 与えられた数値と根拠ページの内容だけを根拠にする。書かれていない事実を作らない。
2. ボトルネックの段階はすでに決定済みとして与えられる。別の段階を提案しない。
3. 過去に実施したタスクの効果が示されている場合、それを踏まえる。効果が
   無かった施策と同じ方向性を「効くはずだ」と繰り返し主張しない。
4. 出力は日本語で書く。`;

function buildSystemPrompt(product: typeof schema.products.$inferSelect, context: typeof schema.productContexts.$inferSelect): string {
  return renderContextSnapshot(product, context) + DIAGNOSE_SYSTEM_SUFFIX;
}

function formatRate(rate: number | null): string {
  return rate === null ? "計測不可" : `${(rate * 100).toFixed(1)}%`;
}

function renderFunnelEvidence(funnel: FunnelResult, bottleneckStage: FunnelStage): string {
  const lines = [
    `# 直近${Math.round((funnel.windowEnd.getTime() - funnel.windowStart.getTime()) / 86_400_000)}日間のファネル`,
    "",
    `Visit: ${funnel.totalSessions} セッション`,
    ...funnel.stages.map(
      (stage) => `${stage.stage}: ${stage.sessions} セッション (直前比 ${formatRate(stage.rateFromPrevious)})`,
    ),
    "",
    "# 流入元",
    ...funnel.reachBySource.slice(0, 5).map((s) => `- ${s.source}: ${s.sessions}`),
    "",
    funnel.bottleneck
      ? `# コードが特定したボトルネック\n${bottleneckStage} (直前比 ${formatRate(funnel.bottleneck.rateFromPrevious)}, 損失 ${funnel.bottleneck.sessionsLost} セッション)`
      : `# コードが特定したボトルネック\n${bottleneckStage} (突出した離脱段階はないが、必ず1段階を選ぶ規則により選出)`,
  ];
  if (!funnel.hasKeyEvent) {
    lines.push("", "注記: キーイベント未設定のため Activate 以降は正確に計測できていない。");
  }
  return lines.join("\n");
}

/**
 * The thing that makes a second diagnosis an actual re-diagnosis rather than
 * the same reasoning rerun on fresher numbers (spec's ⑤ LEARN). Empty on a
 * product's first diagnosis, or whenever nothing completed has had time to be
 * evaluated yet (evaluateOutcome refuses to score a task before its
 * after-window has elapsed) — both are normal, not errors.
 */
function renderPastOutcomes(outcomes: PastOutcome[]): string {
  if (outcomes.length === 0) return "";
  const lines = [
    "",
    "# 過去に実施したタスクの効果",
    ...outcomes.map((o) => {
      const direction = o.delta > 0 ? "増加" : o.delta < 0 ? "減少" : "変化なし";
      return `- 「${o.taskTitle}」(${o.stage}, 期待: ${o.expectedMetric}が${o.expectedDirection === "up" ? "上がる" : "下がる"}) → 実施${o.windowDays}日後: ${o.before} → ${o.after} (${direction})`;
    }),
  ];
  return lines.join("\n");
}

function renderAuditEvidence(findings: AuditFinding[]): string {
  const lines = [
    "# サイト監査結果（セッション数が少なくファネルが計測できないため、静的な監査に切り替え）",
    "",
    ...findings.map((f) => `- [${f.passed ? "OK" : "NG"}] ${f.detail}`),
    "",
    "# コードが特定したボトルネック",
    "reach (トラフィックが少なすぎて他の段階を計測できない — まず流入経路を作る必要がある)",
  ];
  return lines.join("\n");
}

/**
 * Picks a stage to blame even when funnel.ts's arithmetic found nothing
 * losing volume (every transition held or improved) — the diagnoses table
 * requires one, and "everything is fine, structurally" still has a most
 * relevant next stage to look at, which is whichever one is earliest in the
 * sequence and not yet saturated at 100%.
 */
function fallbackBottleneckStage(funnel: FunnelResult): FunnelStage {
  for (const stage of funnel.stages) {
    if (stage.rateFromPrevious !== null && stage.rateFromPrevious < 1) return stage.stage;
  }
  return "retain";
}

export interface DiagnoseOptions {
  provider?: LLMProvider;
  windowDays?: number;
  now?: Date;
  database?: Database;
}

export async function diagnoseProduct(productId: string, options: DiagnoseOptions = {}): Promise<Diagnosis> {
  const conn = options.database ?? db;
  const provider = options.provider ?? (await getProvider());

  const product = await conn.query.products.findFirst({ where: eq(schema.products.id, productId) });
  if (!product) throw new AppError("NOT_FOUND", `Unknown product: ${productId}`);

  const context = await conn.query.productContexts.findFirst({
    where: eq(schema.productContexts.productId, productId),
    orderBy: (contexts, { desc }) => [desc(contexts.version)],
  });
  if (!context) throw new AppError("CONFLICT", `Product ${productId} has no Product Context yet`);

  const funnel = await getFunnel(productId, { windowDays: options.windowDays, now: options.now });

  let mode: (typeof schema.DIAGNOSIS_MODES)[number];
  let bottleneckStage: FunnelStage;
  let userPrompt: string;
  let evidence: Record<string, unknown>;

  const pastOutcomes = await getRecentOutcomes(productId, 5, conn);
  const pastOutcomesSection = renderPastOutcomes(pastOutcomes);

  if (funnel.isColdStart) {
    mode = "audit";
    bottleneckStage = "reach";
    const pages = await conn.query.crawlPages.findMany({ where: eq(schema.crawlPages.productId, productId) });
    const findings = runSiteAudit(pages, context);
    userPrompt = renderAuditEvidence(findings) + pastOutcomesSection;
    evidence = { funnel: funnelEvidenceSummary(funnel), audit: findings, pastOutcomes };
  } else {
    mode = "funnel";
    bottleneckStage = funnel.bottleneck?.stage ?? fallbackBottleneckStage(funnel);
    userPrompt = renderFunnelEvidence(funnel, bottleneckStage) + pastOutcomesSection;
    evidence = { funnel: funnelEvidenceSummary(funnel), pastOutcomes };
  }

  /*
   * Everything above this line was decided without a model: the funnel, the
   * bottleneck, the audit findings. Only the explanation needs one.
   *
   * So when the model fails, no diagnoses row is written. A template summary
   * would be arithmetic wearing a reasoning costume — and worse, it would be
   * persisted, read back by renderPastOutcomes, and fed into the next
   * diagnosis, so Grape would end up learning from sentences no intelligence
   * produced. The hint carries the part that *is* known, so the UI can point
   * at the numbers instead of showing nothing.
   */
  let value: z.infer<typeof DiagnosisNarrativeSchema>;
  let model: string;
  try {
    ({ value, model } = await provider.completeStructured({
      kind: "diagnose",
      schemaName: "diagnosis_summary",
      schema: DiagnosisNarrativeSchema,
      system: buildSystemPrompt(product, context),
      user: userPrompt,
    }));
  } catch (error) {
    const appError = toAppError(error);
    throw new AppError(appError.code, appError.message, {
      cause: error,
      hint: `詰まっている段階は「${STAGE_UI[bottleneckStage].label}」と計算できています`,
    });
  }

  const [row] = await conn
    .insert(schema.diagnoses)
    .values({
      productId,
      contextVersion: context.version,
      windowStart: funnel.windowStart,
      windowEnd: funnel.windowEnd,
      mode,
      bottleneckStage,
      summary: value.summary,
      evidence,
      confidence: value.confidence,
      model,
    })
    .returning();

  return row;
}

/** What gets persisted as `diagnoses.evidence` for the funnel path — the raw FunnelResult minus fields that do not survive JSON (Dates become strings, Maps were never here). */
function funnelEvidenceSummary(funnel: FunnelResult) {
  return {
    windowStart: funnel.windowStart.toISOString(),
    windowEnd: funnel.windowEnd.toISOString(),
    totalSessions: funnel.totalSessions,
    reachBySource: funnel.reachBySource,
    stages: funnel.stages,
    hasKeyEvent: funnel.hasKeyEvent,
    bottleneck: funnel.bottleneck,
  };
}
