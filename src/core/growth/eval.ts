/**
 * Runs the whole growth loop once, for real, against one product URL — and
 * reports what every model call cost, how long it took, and what it wrote.
 *
 *   ANTHROPIC_API_KEY=… pnpm growth:eval https://some-saas.example/ out.json
 *
 * The real crawler, the real Anthropic provider and web search, the real
 * Hacker News and competitor pages; only the database is in memory, so it
 * touches no Firestore and no account. It is how the prompts and effort
 * levels in core/growth were tuned: read the JSON it writes, change a
 * prompt, run it again, compare.
 */
import { writeFileSync } from "node:fs";

import { analyzeSaas } from "@/core/context/analyze";
import { crawlSite } from "@/core/context/crawl";
import { contextFromAnalysis } from "@/core/context/derive";
import { AnthropicProvider } from "@/core/llm/anthropic";
import { withBudgetGuard } from "@/core/llm/budget";
import { estimateCostUsd } from "@/core/llm/pricing";
import type { CompletionRequest, CompletionResult, LLMProvider, StructuredCompletionRequest } from "@/core/llm/types";
import { currentSettings } from "@/core/settings";
import { createMemoryStore } from "@/db/store/memory";

import { growthExecutor, startGrowthRun } from "./agent";
import { setGoal } from "./goals";
import { advanceRun } from "./runs";
import { createHackerNewsSource } from "./sources/hackernews";
import { fetchPublicPage } from "./sources/page";
import { AnthropicWebResearcher, WEB_SEARCH_COST_USD, type WebResearcher } from "./sources/web";

interface CallLog {
  name: string;
  kind: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  costUsd: number;
}

function logged(provider: LLMProvider, calls: CallLog[]): LLMProvider {
  const record = async <T,>(name: string, req: CompletionRequest, run: () => Promise<CompletionResult<T>>) => {
    const started = Date.now();
    let result: CompletionResult<T>;
    try {
      result = await run();
    } catch (error) {
      // A failed call that a step then retries is invisible in the step's
      // summary; this is where it shows up, with how long it held the step.
      calls.push({ name: `${name} FAILED: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`, kind: req.kind, ms: Date.now() - started, inputTokens: 0, outputTokens: 0, cacheRead: 0, costUsd: 0 });
      throw error;
    }
    calls.push({
      name,
      kind: req.kind,
      ms: Date.now() - started,
      inputTokens: result.usage.inputTokens + result.usage.cacheCreationInputTokens,
      outputTokens: result.usage.outputTokens,
      cacheRead: result.usage.cacheReadInputTokens,
      costUsd: estimateCostUsd("anthropic", result.model, result.usage),
    });
    return result;
  };
  return {
    name: provider.name,
    model: provider.model,
    health: () => provider.health(),
    completeText: (req) => record("text", req, () => provider.completeText(req)),
    completeStructured: <T,>(req: StructuredCompletionRequest<T>) => record(req.schemaName, req, () => provider.completeStructured(req)),
  };
}

function loggedResearcher(researcher: WebResearcher, calls: CallLog[]): WebResearcher {
  return {
    name: researcher.name,
    async research(req) {
      const started = Date.now();
      const result = await researcher.research(req);
      calls.push({
        name: `web_search(${result.searches})`,
        kind: "research",
        ms: Date.now() - started,
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        // Token cost of the search call is in the store's llmCalls; this row adds its searches.
        costUsd: result.searches * WEB_SEARCH_COST_USD,
      });
      return result;
    },
  };
}

async function main() {
  const [url, out = "growth-eval.json"] = process.argv.slice(2);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !apiKey) {
    console.error("usage: ANTHROPIC_API_KEY=… tsx src/core/growth/eval.ts <product url> [out.json]");
    process.exit(2);
  }

  const conn = createMemoryStore();
  const model = currentSettings().ANTHROPIC_MODEL;
  const calls: CallLog[] = [];
  const provider = logged(withBudgetGuard(new AnthropicProvider({ model, apiKey }), conn), calls);
  const web = loggedResearcher(new AnthropicWebResearcher({ apiKey, model, database: conn }), calls);
  const phases: { phase: string; ms: number; calls: number; costUsd: number; summary: string | null; error: string | null }[] = [];

  // Registration: what runProductSetup does, on the in-memory store.
  let started = Date.now();
  const pages = await crawlSite(url);
  const analysis = await analyzeSaas(pages, provider);
  const extraction = contextFromAnalysis(analysis);
  const product = await conn.products.insert({ userId: "eval", url, name: new URL(url).hostname, keyEventName: "signup" });
  await conn.productContexts.insert({
    productId: product.id,
    version: 1,
    what: extraction.what,
    who: extraction.who,
    why: extraction.why,
    how: extraction.how,
    sourcePages: extraction.evidenceUrls,
    confidence: extraction.confidence,
    gaps: extraction.gaps,
    analysis,
    primaryLanguage: extraction.primaryLanguage,
  });
  const costOf = (from: number) => calls.slice(from).reduce((sum, call) => sum + call.costUsd, 0);
  phases.push({ phase: "register", ms: Date.now() - started, calls: calls.length, costUsd: costOf(0), summary: `${pages.length} pages`, error: null });

  await setGoal(product.id, { metric: "signups", target: 100, days: 30 }, conn);
  const { run } = await startGrowthRun(product.id, "eval", "initial", conn);
  const executor = growthExecutor(conn, { provider, web, hackerNews: createHackerNewsSource(), sources: [createHackerNewsSource()], fetchPage: (u) => fetchPublicPage(u) });

  // One step at a time, so each is timed and costed on its own.
  for (const step of run.steps) {
    const before = calls.length;
    started = Date.now();
    // advanceRun takes one step; a step put back for its retry is taken again.
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await advanceRun(run.id, executor, conn);
      if (current?.steps.find((s) => s.kind === step.kind)?.status !== "pending") break;
    }
    const recorded = (await conn.growthRuns.get(run.id))!.steps.find((s) => s.kind === step.kind)!;
    phases.push({
      phase: step.kind,
      ms: Date.now() - started,
      calls: calls.length - before,
      costUsd: costOf(before),
      summary: recorded.summary,
      error: recorded.error,
    });
    console.error(`${step.kind}: ${recorded.status} ${((Date.now() - started) / 1000).toFixed(0)}s $${costOf(before).toFixed(3)} — ${recorded.summary ?? recorded.error}`);
  }

  // The store's own accounting — tokens and searches together — is the figure /usage would show.
  const recordedSpend = (await conn.llmCalls.find()).reduce((sum, row) => sum + row.costUsd, 0);

  const report = {
    url,
    model,
    totalSeconds: phases.reduce((s, p) => s + p.ms, 0) / 1000,
    estimatedCostUsd: recordedSpend,
    phases,
    calls,
    outputs: {
      analysis,
      knowledge: await conn.productKnowledge.get(product.id),
      insights: await conn.marketInsights.find(),
      competitors: await conn.competitors.find(),
      icps: await conn.icps.find(),
      strategy: await conn.strategies.find(),
      opportunities: await conn.opportunities.find(),
      posts: await conn.posts.find(),
    },
  };
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.error(`\ntotal ${report.totalSeconds.toFixed(0)}s, ~$${recordedSpend.toFixed(3)} → ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
