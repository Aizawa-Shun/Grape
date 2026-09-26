import { z } from "zod";

import type { LLMProvider } from "@/core/llm/types";
import type { SourceRef } from "@/db/schema";

/**
 * What every growth agent is handed. The provider is injected, never fetched
 * inside an agent, so each agent is a plain function a test can run against
 * a fake — the same rule the diagnose/recommend modules follow.
 *
 * `system` is the Product Knowledge Base prefix (knowledge.ts), identical for
 * every agent on the same day, so providers that cache prefixes serve it once.
 */
export interface AgentDeps {
  provider: LLMProvider;
  system: string;
  /** The audience's language — what search phrases and posts are written in. */
  language: string;
}

/** Rules every agent's prompt ends with. Kept in one place so they cannot drift apart. */
export const COMMON_RULES = `
共通の原則:
- 数字・実績・固有名詞を作らない。入力に無い事実は書かない。
- 推測は推測として書く。断定できない場合はそう書く。
- Grapeの画面に出る説明文（理由・分析）は日本語の「である調」で書く。
- 検索語・投稿文など、ユーザーの顧客が目にする/打ち込む言葉は、指定された言語で書く。`;

/** A list of URLs a model cited, reduced to the ones the run actually fetched. */
export function groundedSources(urls: string[], known: SourceRef[]): SourceRef[] {
  const byUrl = new Map(known.map((source) => [normalizeForMatch(source.url), source]));
  const result = new Map<string, SourceRef>();
  for (const url of urls) {
    const match = byUrl.get(normalizeForMatch(url));
    if (match) result.set(match.url, match);
  }
  return [...result.values()];
}

function normalizeForMatch(url: string): string {
  return url.trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
}

/** Renders fetched sources as a numbered list a model can cite by URL. */
export function renderSources(sources: SourceRef[], limit = 40): string {
  if (sources.length === 0) return "(なし)";
  return sources
    .slice(0, limit)
    .map((source) => `- ${source.url} — ${source.title}`)
    .join("\n");
}

/** A string list the model must fill but may over-fill; trimmed, deduplicated, bounded here. */
export function cleanList(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of items) {
    const item = raw.trim();
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    result.push(item);
    if (result.length >= max) break;
  }
  return result;
}

/** 0–100, rounded and clamped rather than rejected — same rescue as the scores in analysis.ts. */
export const percent = z.preprocess(
  (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return value;
    // Only a genuine fraction (0.87) is read as a 0–1 answer. An integer 1 is
    // "1%" — scaling it made an unrelated post come back as 100% relevant.
    const scaled = value > 0 && value < 1 ? value * 100 : value;
    return Math.min(100, Math.max(0, Math.round(scaled)));
  },
  z.number().int().min(0).max(100),
);
