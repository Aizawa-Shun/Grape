import { z } from "zod";

import type { LLMProvider } from "@/core/llm/types";
import type { BrandVoice } from "@/db/schema";

import { cleanList } from "./shared";

/**
 * Reads a few samples of someone's own writing and describes how it sounds,
 * so every later draft can sound like them rather than like a model (spec §15).
 */

export const BrandVoiceOutput = z.object({
  tone: z.string().describe("トーン。例: 淡々としていて率直"),
  vocabulary: z.string().describe("語彙の傾向。例: 技術用語をそのまま使う、カタカナ語が多い"),
  sentenceLength: z.string().describe("文の長さ。例: 短文を重ねる"),
  emoji: z.string().describe("絵文字の使い方。例: ほぼ使わない"),
  technicalLevel: z.string().describe("技術的な深さ"),
  formality: z.string().describe("丁寧さ。例: 常体、くだけた口調"),
  humor: z.string().describe("ユーモア。例: 自虐をたまに入れる"),
  guidelines: z.array(z.string()).describe("この人らしく書くための具体的な指針を3〜6件。"),
});

export async function analyzeBrandVoice(samples: string[], provider: LLMProvider): Promise<BrandVoice> {
  const kept = samples.map((s) => s.trim()).filter(Boolean).slice(0, 10);
  const { value } = await provider.completeStructured({
    kind: "extract",
    schemaName: "brand_voice",
    schema: BrandVoiceOutput,
    system:
      "あなたは編集者である。ある人が書いた文章のサンプルから、その人の文体の特徴を分析する。" +
      "サンプルから読み取れることだけを書き、日本語の「である調」で説明する。",
    user: kept.map((sample, i) => `## サンプル${i + 1}\n${sample}`).join("\n\n"),
  });
  return { ...value, guidelines: cleanList(value.guidelines, 6), samples: kept };
}
