import { z } from "zod";

import { renderContextSnapshot } from "@/core/context/snapshot";
import { AppError } from "@/core/errors";
import { getProvider, type LLMProvider } from "@/core/llm";
import { getContextVersion, getLatestContext } from "@/core/context/edit";
import { db, type Database } from "@/db/client";
import type { Artifact, ArtifactKind, Channel, Task } from "@/db/schema";

import { X_POST_MAX_CHARS } from "./channels/x";
import { fitToX } from "./channels/x-text";
import { CHANNEL_ARTIFACT_KINDS } from "./kinds";

export { CHANNEL_ARTIFACT_KINDS } from "./kinds";

/**
 * Turns an approved-for-work task into the actual deliverable: the tweet
 * text, the landing-page copy, the title and meta description, the email. This is where extract.ts's `primaryLanguage`
 * finally matters — unlike the diagnosis/recommendation narratives, which are
 * Grape's own advice to the developer and stay Japanese regardless, an
 * artifact is published where the product's own audience reads it.
 */

export type { Artifact, Task };

const ArtifactContentSchema = z.object({
  content: z.string().min(1).describe("生成する文章の本文のみ。前置きや説明文は含めない。"),
});

/** The kind to generate: the one asked for if the channel allows it, else the channel's default. */
export function artifactKindFor(channel: Channel, requested?: ArtifactKind): ArtifactKind {
  const allowed = CHANNEL_ARTIFACT_KINDS[channel];
  if (requested === undefined) return allowed[0];
  if (!allowed.includes(requested)) {
    throw new AppError("INVALID_INPUT", `A ${channel} task cannot produce a ${requested} artifact`, {
      hint: "このタスクでは、その種類の文面は作れません。",
    });
  }
  return requested;
}

/**
 * Search-result limits, by the language the snippet is written in. Japanese
 * is measured in characters and runs out far sooner on screen than English:
 * a result title shows roughly 30 full-width characters, or 60 Latin ones.
 */
export function metaLimits(primaryLanguage: string): { title: number; description: number } {
  return primaryLanguage.toLowerCase().startsWith("ja")
    ? { title: 32, description: 120 }
    : { title: 60, description: 160 };
}

const MetaContentSchema = z.object({
  title: z.string().min(1).describe("検索結果とSNS共有で表示されるページタイトル。"),
  description: z.string().min(1).describe("検索結果とSNS共有で表示される説明文（meta description）。"),
});

const EmailContentSchema = z.object({
  subject: z.string().min(1).describe("メールの件名。"),
  body: z.string().min(1).describe("メールの本文。宛名から署名まで、そのまま送れる形。"),
});

function generateSystemSuffix(kind: ArtifactKind, primaryLanguage: string): string {
  const languageRule = `本文はプロダクトの主要言語（${primaryLanguage}）で書く。Grape自体の管理画面が日本語であることとは関係ない — 読むのはこのプロダクトの利用者。`;

  if (kind === "x_post") {
    return `

あなたは上記プロダクトの成長担当です。以下のタスクを踏まえて、X（旧Twitter）に投稿する文章を1件作成してください。

厳守すること:
1. Xの文字数上限（${X_POST_MAX_CHARS}。日本語などの全角文字は1字を2と数えるので、日本語なら120字程度）に十分収める。
2. Product Contextに書かれていない機能・実績・数字を主張しない。
3. 「必ず」「絶対に」のような誇張表現を避ける。
4. ハッシュタグは0〜2個まで。
5. ${languageRule}`;
  }

  if (kind === "meta") {
    const limits = metaLimits(primaryLanguage);
    return `

あなたは上記プロダクトの成長担当です。以下のタスクを踏まえて、サイトのトップページに設定する
<title> と meta description（OGPの og:title / og:description にも使う）を1組作成してください。
これは自動送信されない — 人間がこの内容を見て自分でサイトに設定する。

厳守すること:
1. title は${limits.title}文字以内。サービス名と「何ができるか」が一目で分かるようにする。
2. description は${limits.description}文字以内。誰の何を解決するかを具体的に書き、最後に次の行動（試す・登録する）につながる一言を入れる。
3. Product Contextに書かれていない機能・実績・数字を主張しない。
4. 「必ず」「絶対に」「No.1」のような誇張表現を避ける。
5. ${languageRule}`;
  }

  if (kind === "email") {
    return `

あなたは上記プロダクトの成長担当です。以下のタスクを踏まえて、このプロダクトの利用者（または
利用を検討している人）に送るメールを1通作成してください。
これは自動送信されない — 人間がこの内容を見て自分で送る。

厳守すること:
1. 件名は短く、開く理由が分かるものにする。
2. 本文は宛名・用件・次に取ってほしい行動（1つだけ）・署名の順で、そのまま送れる完成した文章にする。
3. 宛名や差出人の名前など、分からない部分は［お名前］のような角括弧の空欄にする。作らない。
4. Product Contextに書かれていない機能・実績・数字を主張しない。
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

/**
 * One call per kind, each with its own schema, because the shapes differ in
 * ways that matter after generation: a meta tag is two strings with hard
 * length limits, an email is a subject and a body. Asking for one free-text
 * blob and parsing "title:" back out of it would be trusting the model with
 * formatting the code can guarantee instead.
 *
 * Stored as one text column either way, laid out the way the reader will copy
 * it — labelled lines for meta, subject then body for email.
 */
async function writeContent(
  provider: LLMProvider,
  kind: ArtifactKind,
  system: string,
  user: string,
  primaryLanguage: string,
): Promise<string> {
  const request = { kind: "generate" as const, system, user };
  const japanese = primaryLanguage.toLowerCase().startsWith("ja");

  if (kind === "meta") {
    const limits = metaLimits(primaryLanguage);
    const { value } = await provider.completeStructured({
      ...request,
      schemaName: "meta_tags",
      schema: MetaContentSchema,
    });
    return [
      `title: ${truncateToLimit(value.title.trim(), limits.title)}`,
      `description: ${truncateToLimit(value.description.trim(), limits.description)}`,
    ].join("\n");
  }

  if (kind === "email") {
    const { value } = await provider.completeStructured({
      ...request,
      schemaName: "email",
      schema: EmailContentSchema,
    });
    return `${japanese ? "件名" : "Subject"}: ${value.subject.trim()}\n\n${value.body.trim()}`;
  }

  const { value } = await provider.completeStructured({
    ...request,
    schemaName: "artifact_content",
    schema: ArtifactContentSchema,
  });
  // Measured the way X measures, not with `.length`: a Japanese post runs
  // out at 140 characters (see channels/x-text.ts).
  return kind === "x_post" ? fitToX(value.content.trim()) : value.content.trim();
}

export interface GenerateOptions {
  provider?: LLMProvider;
  database?: Database;
  /** Which deliverable to write; defaults to the task channel's own (see CHANNEL_ARTIFACT_KINDS). */
  kind?: ArtifactKind;
}

export async function generateArtifact(taskId: string, options: GenerateOptions = {}): Promise<Artifact> {
  const conn = options.database ?? db;
  const provider = options.provider ?? (await getProvider());

  const task = await conn.tasks.get(taskId);
  if (!task) throw new AppError("NOT_FOUND", `Unknown task: ${taskId}`);

  const product = await conn.products.get(task.productId);
  if (!product) throw new AppError("NOT_FOUND", `Unknown product: ${task.productId}`);

  // Generate against the same Context version the task's diagnosis reasoned
  // over (falling back to latest if the task predates any diagnosis, or the
  // diagnosis was since deleted — diagnosisId is ON DELETE SET NULL).
  const diagnosis = task.diagnosisId
    ? await conn.diagnoses.get(task.diagnosisId)
    : undefined;

  const context = diagnosis
    ? await getContextVersion(task.productId, diagnosis.contextVersion, conn)
    : await getLatestContext(task.productId, conn);

  if (!context) throw new AppError("CONFLICT", `Product ${task.productId} has no Product Context yet`);

  const kind = artifactKindFor(task.channel, options.kind);
  const primaryLanguage = context.primaryLanguage ?? "ja";
  // Null only for rows extracted before primaryLanguage existed as a column;
  // "ja" matches the audience this codebase has been built and verified
  // against, and is a better default than silently writing English.
  const system = renderContextSnapshot(product, context) + generateSystemSuffix(kind, primaryLanguage);
  const user = buildTaskPrompt(task);

  const content = await writeContent(provider, kind, system, user, primaryLanguage);
  return conn.artifacts.insert({ taskId, kind, content });
}
