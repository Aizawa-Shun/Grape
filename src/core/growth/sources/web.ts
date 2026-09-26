import Anthropic from "@anthropic-ai/sdk";

import { getLlmApiKey } from "@/core/auth/users";
import { isOutOfCredit } from "@/core/llm/anthropic";
import { assertWithinBudget, recordCall } from "@/core/llm/budget";
import { LLMError, type Usage } from "@/core/llm/types";
import { currentSettings } from "@/core/settings";
import type { Database } from "@/db/client";
import type { SourceRef } from "@/db/schema";
import { currentUserId } from "@/server/context";

/**
 * Reads the open web, for the growth loop's research steps.
 *
 * Its own interface rather than a method on LLMProvider, on purpose: that
 * interface is kept to what every provider can do (core/llm/types.ts), and
 * searching the web is something only one of them does server-side. Grape
 * keeps working without it — research then runs on what the model already
 * knows plus Hacker News, and every finding says it was not checked against a
 * source (see MarketInsight.grounded).
 *
 * The output is prose plus the sources behind it, never structured JSON:
 * web search answers with citations, and citations cannot be combined with a
 * structured output format in the same call. The structuring is a second,
 * ordinary provider call (core/growth/agents/*), which is also what keeps the
 * shape of every finding independent of which provider wrote it.
 */

export interface WebCitation {
  url: string;
  title: string;
  /** Text as it appears on the page — the one part of a result that can be quoted. */
  quote: string;
}

export interface WebResearchResult {
  memo: string;
  sources: SourceRef[];
  citations: WebCitation[];
  searches: number;
}

export interface WebResearchRequest {
  /** What this search is for, and how to report back. Stable across runs. */
  instructions: string;
  /** The volatile part: this product, these questions. */
  question: string;
  maxSearches: number;
  allowedDomains?: string[];
  productId?: string;
  /** How hard to think while searching. Finding posts needs less than weighing a market. */
  effort?: "low" | "medium" | "high";
}

export interface WebResearcher {
  readonly name: string;
  research(req: WebResearchRequest): Promise<WebResearchResult>;
}

/** Anthropic's list price: $10 per 1,000 searches, billed on top of tokens. */
export const WEB_SEARCH_COST_USD = 0.01;

/** A paused server-side loop is resumed at most this many times before we keep what we have. */
const MAX_CONTINUATIONS = 3;

/** Several searches plus reading the results takes longer than one completion. */
const RESEARCH_TIMEOUT_MS = 240_000;

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function addUsage(total: Usage, usage: Anthropic.Beta.BetaUsage): Usage {
  return {
    inputTokens: total.inputTokens + (usage.input_tokens ?? 0),
    outputTokens: total.outputTokens + (usage.output_tokens ?? 0),
    cacheReadInputTokens: total.cacheReadInputTokens + (usage.cache_read_input_tokens ?? 0),
    cacheCreationInputTokens: total.cacheCreationInputTokens + (usage.cache_creation_input_tokens ?? 0),
  };
}

/**
 * Everything a response actually fetched, deduplicated by URL. Pulled from the
 * result blocks themselves rather than from anything the model wrote, so a
 * source listed here is one the search really returned.
 */
export function collectSources(content: Anthropic.Beta.BetaContentBlock[]): {
  sources: SourceRef[];
  citations: WebCitation[];
  text: string;
} {
  const sources = new Map<string, SourceRef>();
  const citations: WebCitation[] = [];
  const text: string[] = [];

  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (!sources.has(result.url)) sources.set(result.url, { url: result.url, title: result.title });
      }
    }
    if (block.type === "text") {
      text.push(block.text);
      for (const citation of block.citations ?? []) {
        if (citation.type !== "web_search_result_location") continue;
        citations.push({ url: citation.url, title: citation.title ?? citation.url, quote: citation.cited_text });
        if (!sources.has(citation.url)) {
          sources.set(citation.url, { url: citation.url, title: citation.title ?? citation.url });
        }
      }
    }
  }

  return { sources: [...sources.values()], citations, text: text.join("") };
}

export class AnthropicWebResearcher implements WebResearcher {
  readonly name = "anthropic-web-search";
  readonly #client: Anthropic;
  readonly #model: string;
  readonly #database: Database | undefined;

  constructor(options: { apiKey: string; model: string; database?: Database }) {
    this.#model = options.model;
    this.#database = options.database;
    this.#client = new Anthropic({ apiKey: options.apiKey, timeout: RESEARCH_TIMEOUT_MS, maxRetries: 1 });
  }

  async research(req: WebResearchRequest): Promise<WebResearchResult> {
    await assertWithinBudget(this.#database);

    const tool = {
      type: "web_search_20260209" as const,
      name: "web_search" as const,
      max_uses: req.maxSearches,
      ...(req.allowedDomains?.length ? { allowed_domains: req.allowedDomains } : {}),
    };

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: req.question }];
    const collected: Anthropic.Beta.BetaContentBlock[] = [];
    let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
    let searches = 0;
    let model = this.#model;

    try {
      for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
        const response = await this.#client.beta.messages.create({
          model: this.#model,
          max_tokens: 16_000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort: req.effort ?? "medium" },
          system: [{ type: "text", text: req.instructions, cache_control: { type: "ephemeral" } }],
          tools: [tool],
          messages,
        });

        model = response.model;
        usage = addUsage(usage, response.usage);
        searches += response.usage.server_tool_use?.web_search_requests ?? 0;
        collected.push(...response.content);

        if (response.stop_reason === "refusal") {
          throw new LLMError("Web research was declined on policy grounds", this.name, "refused");
        }
        // The server-side loop hit its own iteration cap. Sending the paused
        // turn back is how it resumes — no extra "continue" message.
        if (response.stop_reason !== "pause_turn") break;
        messages.push({ role: "assistant", content: response.content });
      }
    } catch (error) {
      if (error instanceof LLMError) throw error;
      throw new LLMError(
        error instanceof Error ? error.message : String(error),
        this.name,
        error instanceof Anthropic.AuthenticationError
          ? "auth"
          : isOutOfCredit(error)
            ? "billing"
          : error instanceof Anthropic.RateLimitError
            ? "rate_limited"
            : error instanceof Anthropic.APIConnectionTimeoutError
              ? "timeout"
              : "unreachable",
        error,
      );
    } finally {
      // Recorded even when the call failed partway: the searches that did run
      // were billed.
      if (usage.inputTokens > 0 || searches > 0) {
        await recordCall({
          taskKind: "research",
          provider: "anthropic",
          model,
          usage,
          productId: req.productId,
          extraCostUsd: searches * WEB_SEARCH_COST_USD,
        }, this.#database);
      }
    }

    const { sources, citations, text } = collectSources(collected);
    return { memo: text.trim(), sources, citations, searches };
  }
}

/**
 * The researcher for whoever is asking, or null when there is none — the
 * instance is not on Anthropic, or this account has no Anthropic key. Null is
 * an ordinary answer here, not an error: every caller has a way to carry on.
 */
export async function getWebResearcher(): Promise<WebResearcher | null> {
  const settings = currentSettings();
  if (settings.LLM_PROVIDER !== "anthropic") return null;
  const userId = currentUserId();
  if (!userId) return null;
  const apiKey = await getLlmApiKey(userId, "anthropic");
  if (!apiKey) return null;
  return new AnthropicWebResearcher({ apiKey, model: settings.ANTHROPIC_MODEL });
}
