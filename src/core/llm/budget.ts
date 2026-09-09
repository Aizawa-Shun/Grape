import { gte, sql } from "drizzle-orm";

import { currentSettings } from "@/core/settings";
import { currentUserId } from "@/server/context";
import { db, schema, type Database } from "@/db/client";

import { estimateCostUsd } from "./pricing";
import { LLMError, type CompletionRequest, type LLMProvider, type Usage } from "./types";

/**
 * Wraps a provider so every call is checked against `LLM_MONTHLY_BUDGET_USD`
 * before it goes out and recorded after it comes back — the only place this
 * needs to happen, since `getProvider()` (src/core/llm/index.ts) is the sole
 * place the rest of Grape acquires a provider.
 *
 * Applied there, not to each of the four call sites (extract, diagnose,
 * generate, recommend): a check duplicated four times drifts the moment a
 * fifth is added, and a test double passed as `options.provider` bypasses
 * this by construction, which is correct — a unit test should not need a
 * database to run.
 */
export function withBudgetGuard(provider: LLMProvider, database: Database = db): LLMProvider {
  return {
    name: provider.name,
    model: provider.model,
    health: provider.health.bind(provider),

    async completeText(req: CompletionRequest) {
      await assertWithinBudget(database);
      const result = await provider.completeText(req);
      await recordCall(
        { taskKind: req.kind, provider: provider.name, model: result.model, usage: result.usage },
        database,
      );
      return result;
    },

    async completeStructured(req) {
      await assertWithinBudget(database);
      const result = await provider.completeStructured(req);
      await recordCall(
        { taskKind: req.kind, provider: provider.name, model: result.model, usage: result.usage },
        database,
      );
      return result;
    },
  };
}

/**
 * UTC, not the server's local timezone: `createdAt` is stored as an absolute
 * instant, and a boundary computed from local wall-clock time would put a
 * call recorded near midnight in a different "month" depending on which
 * timezone the process happens to run in.
 */
function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Sum of `costUsd` for calls recorded since the start of the current calendar month. */
export async function monthSpendUsd(database: Database = db, now: Date = new Date()): Promise<number> {
  const rows = await database
    .select({ total: sql<number>`coalesce(sum(${schema.llmCalls.costUsd}), 0)` })
    .from(schema.llmCalls)
    .where(gte(schema.llmCalls.createdAt, startOfMonth(now)));
  return rows[0]?.total ?? 0;
}

/**
 * Checked before spend, not after: the alternative (record first, refuse the
 * *next* call) lets one call blow arbitrarily far past the ceiling if a
 * single request is expensive enough. This can still overshoot by the cost of
 * one in-flight call, which is accepted — the guard's job is to stop a loop
 * from running unattended overnight, not to bill to the cent.
 */
export async function assertWithinBudget(database: Database = db, now: Date = new Date()): Promise<void> {
  const budget = currentSettings().LLM_MONTHLY_BUDGET_USD;
  const spent = await monthSpendUsd(database, now);
  if (spent >= budget) {
    throw new LLMError(
      `Monthly LLM budget of $${budget.toFixed(2)} reached ($${spent.toFixed(2)} spent so far this month).`,
      "budget",
      "budget_exceeded",
    );
  }
}

export interface RecordCallInput {
  taskKind: string;
  provider: string;
  model: string;
  usage: Usage;
  productId?: string;
  /** Overrides the ambient session, for callers that already know the owner. */
  userId?: string;
}

export async function recordCall(input: RecordCallInput, database: Database = db): Promise<void> {
  const costUsd = estimateCostUsd(input.provider, input.model, input.usage);
  await database.insert(schema.llmCalls).values({
    productId: input.productId,
    // Read here, per call, rather than captured when the provider was wrapped:
    // getProvider() caches one provider across requests, so a user captured at
    // construction would have every later caller's spend billed to them.
    // Undefined for scripts and tests, which is honest — nobody asked for
    // those.
    userId: input.userId ?? currentUserId(),
    // Assumed valid: every caller currently in this codebase passes a
    // `TaskKind` from `CompletionRequest`, which the schema's own type already
    // constrains. Widened to `string` here only so this module does not need
    // to import the enum for a check the type system already performed once.
    taskKind: input.taskKind as (typeof schema.llmCalls.$inferInsert)["taskKind"],
    provider: input.provider,
    model: input.model,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cacheReadInputTokens: input.usage.cacheReadInputTokens,
    cacheCreationInputTokens: input.usage.cacheCreationInputTokens,
    costUsd,
  });
}
