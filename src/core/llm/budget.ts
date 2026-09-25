import { currentSettings } from "@/core/settings";
import { currentUserId } from "@/server/context";
import { db, type Database } from "@/db/client";
import type { LlmCall } from "@/db/schema";
import type { Filter } from "@/db/store/types";

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

/**
 * Sum of `costUsd` for calls recorded since the start of the current calendar
 * month — for the given account when `userId` is passed, across every
 * account otherwise.
 *
 * `userId` matters more than it looks. Each account now calls the model on
 * its own API key (core/auth/users.ts), so an unfiltered total mixes spend
 * that lands on entirely different bills. `assertWithinBudget` always passes
 * one, since the cap it enforces is per account for exactly that reason; the
 * unfiltered form stays for anything that genuinely wants the whole
 * instance's estimate.
 */
export async function monthSpendUsd(
  database: Database = db,
  now: Date = new Date(),
  userId?: string,
): Promise<number> {
  return database.llmCalls.sum("costUsd", thisMonth(now, userId));
}

/**
 * This month's calls, optionally one account's. The range filter is on
 * `createdAt`, and an account's is an equality on `userId` beside it — the
 * composite index firestore.indexes.json declares for exactly this.
 */
function thisMonth(now: Date, userId: string | undefined): Filter<LlmCall>[] {
  const since: Filter<LlmCall> = ["createdAt", ">=", startOfMonth(now)];
  return userId ? [["userId", "==", userId], since] : [since];
}

/**
 * Where this month's estimate came from.
 *
 * /settings already shows the single total, next to the limit it is checked
 * against — that is a setting with its context. This is the other question:
 * having seen the number, which work produced it — grouped by task kind and
 * by model, the two answers that tell a runaway loop from a pricey model.
 *
 * Estimated throughout, like everything built on `costUsd` — see pricing.ts.
 *
 * Scoped to one account when `userId` is passed, same as `monthSpendUsd` and
 * for the same reason: each account now spends against its own API key, so
 * /usage shows the viewer their own breakdown by default rather than a mix of
 * bills that are not theirs to see or explain.
 */
export interface SpendGroup {
  key: string;
  calls: number;
  costUsd: number;
}

export interface RecentCall {
  id: string;
  taskKind: string;
  model: string;
  costUsd: number;
  createdAt: Date;
}

export interface MonthUsage {
  spentUsd: number;
  budgetUsd: number;
  byTaskKind: SpendGroup[];
  byModel: SpendGroup[];
  recent: RecentCall[];
}

/** How many recent calls the screen lists — enough to recognise a runaway loop. */
const RECENT_LIMIT = 12;

export async function monthUsage(
  database: Database = db,
  now: Date = new Date(),
  userId?: string,
): Promise<MonthUsage> {
  // One read of the month's calls, grouped here. Firestore has no GROUP BY,
  // and a month of one account's calls is small enough that fetching them is
  // cheaper than an aggregation query per group would be.
  const calls = await database.llmCalls.find({
    where: thisMonth(now, userId),
    orderBy: [["createdAt", "desc"]],
  });

  const group = (keyOf: (call: LlmCall) => string): SpendGroup[] => {
    const groups = new Map<string, SpendGroup>();
    for (const call of calls) {
      const key = keyOf(call);
      const group = groups.get(key) ?? { key, calls: 0, costUsd: 0 };
      group.calls += 1;
      group.costUsd += call.costUsd;
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.costUsd - a.costUsd);
  };

  const byTaskKind = group((call) => call.taskKind);
  const byModel = group((call) => call.model);
  const recent: RecentCall[] = calls.slice(0, RECENT_LIMIT).map((call) => ({
    id: call.id,
    taskKind: call.taskKind,
    model: call.model,
    costUsd: call.costUsd,
    createdAt: call.createdAt,
  }));

  return {
    spentUsd: byTaskKind.reduce((total, row) => total + row.costUsd, 0),
    budgetUsd: currentSettings().LLM_MONTHLY_BUDGET_USD,
    byTaskKind,
    byModel,
    recent,
  };
}

/**
 * Checked before spend, not after: the alternative (record first, refuse the
 * *next* call) lets one call blow arbitrarily far past the ceiling if a
 * single request is expensive enough. This can still overshoot by the cost of
 * one in-flight call, which is accepted — the guard's job is to stop a loop
 * from running unattended overnight, not to bill to the cent.
 *
 * Scoped to the calling account, read the same way `recordCall` reads it —
 * per call, from the ambient request scope, never captured once when the
 * provider was built. Each account now spends against its own API key, so
 * the cap this enforces has to be per account too: an instance-wide total
 * would let one member's usage block a completely different member's calls
 * over a bill that was never theirs.
 */
export async function assertWithinBudget(database: Database = db, now: Date = new Date()): Promise<void> {
  const budget = currentSettings().LLM_MONTHLY_BUDGET_USD;
  const spent = await monthSpendUsd(database, now, currentUserId());
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
  await database.llmCalls.insert({
    productId: input.productId ?? null,
    // Read here, per call, rather than captured when the provider was wrapped:
    // getProvider() caches one provider across requests, so a user captured at
    // construction would have every later caller's spend billed to them.
    // Undefined for scripts and tests, which is honest — nobody asked for
    // those.
    userId: input.userId ?? currentUserId() ?? null,
    // Assumed valid: every caller currently in this codebase passes a
    // `TaskKind` from `CompletionRequest`, which the schema's own type already
    // constrains. Widened to `string` here only so this module does not need
    // to import the enum for a check the type system already performed once.
    taskKind: input.taskKind as LlmCall["taskKind"],
    provider: input.provider,
    model: input.model,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cacheReadInputTokens: input.usage.cacheReadInputTokens,
    cacheCreationInputTokens: input.usage.cacheCreationInputTokens,
    costUsd,
  });
}
