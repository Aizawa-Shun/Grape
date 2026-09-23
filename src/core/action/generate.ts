import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { renderContextSnapshot } from "@/core/context/snapshot";
import { AppError } from "@/core/errors";
import { getProvider, type LLMProvider } from "@/core/llm";
import { db, schema, type Database } from "@/db/client";
import type { ArtifactKind, Channel } from "@/db/schema";

import { X_POST_MAX_CHARS } from "./channels/x";

/**
 * Turns an approved-for-work task into the actual deliverable: the tweet
 * text, the landing-page copy. This is where extract.ts's `primaryLanguage`
 * finally matters — unlike the diagnosis/recommendation narratives, which are
 * Grape's own advice to the developer and stay Japanese regardless, an
 * artifact is published where the product's own audience reads it.
 */

export type Task = typeof schema.tasks.$inferSelect;
export type Artifact = typeof schema.artifacts.$inferSelect;

const ArtifactContentSchema = z.object({
  content: z.string().min(1).describe("生成する文章の本文のみ。前置きや説明文は含めない。"),
});

/** Which artifact shape a task's channel produces. `manual` covers copy the human pastes somewhere themselves. */
const CHANNEL_ARTIFACT_KIND: Record<Channel, ArtifactKind> = {
  x: "x_post",
  manual: "lp_copy",
};

function generateSystemSuffix(kind: ArtifactKind, primaryLanguage: string): string {
  const languageRule = `本文はプロダクトの主要言語（${primaryLanguage}）で書く。Grape自体の管理画面が日本語であることとは関係ない — 読むのはこのプロダクトの利用者。`;

  if (kind === "x_post") {
    return `

あなたは上記プロダクトの成長担当です。以下のタスクを踏まえて、X（旧Twitter）に投稿する文章を1件作成してください。

厳守すること:
1. ${X_POST_MAX_CHARS}文字より十分短く、240文字程度を目安にする。
2. Product Contextに書かれていない機能・実績・数字を主張しない。
3. 「必ず」「絶対に」のような誇張表現を避ける。
4. ハッシュタグは0〜2個まで。
5. ${languageRule}`;
  }

  return `

あなたは上記プロダクトの成長担当です。以下のタスクを人間が今週手作業で実行するために必要な、
すぐ使える具体的な文章（サイトに貼るコピー、送るメッセージなど）を作成してください。
これは自動送信されない — 人間がこの内容を見て自分で使う。

厳守すること:
1. Product Contextに書かれていない機能・実績・数字を主張しない。
2. すぐそのまま使える完成した文章にする。指示や解説ではなく成果物そのものを書く。
3. ${languageRule}`;
}

function buildTaskPrompt(task: Task): string {
  return [
    `# 今週のタスク`,
    `タイトル: ${task.title}`,
    `理由: ${task.rationale}`,
    `期待する変化: ${task.expectedMetric} が${task.expectedDirection === "up" ? "上がる" : "下がる"}`,
  ].join("\n");
}

/**
 * A model asked to stay under a limit still overflows it sometimes — same
 * reason confidence scores get rescued elsewhere. Truncating mid-word reads
 * as broken, so this backs off to the last word boundary that fits and marks
 * the cut with an ellipsis, itself counted against the limit.
 */
export function truncateToLimit(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const ellipsis = "…";
  const cut = content.slice(0, maxChars - ellipsis.length);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut) + ellipsis;
}

export interface GenerateOptions {
  provider?: LLMProvider;
  database?: Database;
}

export async function generateArtifact(taskId: string, options: GenerateOptions = {}): Promise<Artifact> {
  const conn = options.database ?? db;
  const provider = options.provider ?? (await getProvider());

  const task = await conn.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!task) throw new AppError("NOT_FOUND", `Unknown task: ${taskId}`);

  const product = await conn.query.products.findFirst({ where: eq(schema.products.id, task.productId) });
  if (!product) throw new AppError("NOT_FOUND", `Unknown product: ${task.productId}`);

  // Generate against the same Context version the task's diagnosis reasoned
  // over (falling back to latest if the task predates any diagnosis, or the
  // diagnosis was since deleted — diagnosisId is ON DELETE SET NULL).
  const diagnosis = task.diagnosisId
    ? await conn.query.diagnoses.findFirst({ where: eq(schema.diagnoses.id, task.diagnosisId) })
    : undefined;

  const context = diagnosis
    ? await conn.query.productContexts.findFirst({
        where: and(
          eq(schema.productContexts.productId, task.productId),
          eq(schema.productContexts.version, diagnosis.contextVersion),
        ),
      })
    : await conn.query.productContexts.findFirst({
        where: eq(schema.productContexts.productId, task.productId),
        orderBy: (contexts, { desc }) => [desc(contexts.version)],
      });

  if (!context) throw new AppError("CONFLICT", `Product ${task.productId} has no Product Context yet`);

  const kind = CHANNEL_ARTIFACT_KIND[task.channel];

  const { value } = await provider.completeStructured({
    kind: "generate",
    schemaName: "artifact_content",
    schema: ArtifactContentSchema,
    // Null only for rows extracted before primaryLanguage existed as a
    // column; "ja" matches the audience this codebase has been built and
    // verified against, and is a better default than silently writing English.
    system: renderContextSnapshot(product, context) + generateSystemSuffix(kind, context.primaryLanguage ?? "ja"),
    user: buildTaskPrompt(task),
  });

  const content =
    kind === "x_post" ? truncateToLimit(value.content.trim(), X_POST_MAX_CHARS) : value.content.trim();

  const [row] = await conn.insert(schema.artifacts).values({ taskId, kind, content }).returning();
  return row;
}
