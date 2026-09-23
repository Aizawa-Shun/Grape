import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetSettingsCache, saveSettings } from "@/core/settings";
import { runInRequestScope } from "@/server/context";
import * as schema from "@/db/schema";

import { assertWithinBudget, monthSpendUsd, recordCall, withBudgetGuard } from "./budget";
import { EMPTY_USAGE, LLMError, type LLMProvider } from "./types";

/**
 * A real, migrated in-memory database rather than a mock: the thing under
 * test is a SUM query plus a month-boundary WHERE clause, and a hand-rolled
 * fake of that would just be a second, unverified implementation of the same
 * arithmetic sitting next to the first.
 */
async function testDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

type TestDb = Awaited<ReturnType<typeof testDb>>;

/** llm_calls.user_id is a real foreign key — a per-account test row needs an actual users row behind it. */
async function makeUser(db: TestDb, id: string): Promise<void> {
  await db.insert(schema.users).values({
    id,
    email: `${id}@example.com`,
    displayName: id,
    passwordHash: "unused-in-this-test",
  });
}

afterEach(() => {
  resetSettingsCache();
});

describe("monthSpendUsd / recordCall", () => {
  it("excludes a call from the previous month even though a row exists", async () => {
    const db = await testDb();

    // Insert directly with an explicit past timestamp, since recordCall
    // always stamps "now" and this test needs to control that value.
    await db.insert(schema.llmCalls).values({
      taskKind: "diagnose",
      provider: "anthropic",
      model: "claude-opus-5",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: 15,
      createdAt: new Date("2026-02-28T23:59:59Z"),
    });

    const spent = await monthSpendUsd(db, new Date("2026-03-01T00:00:00Z"));
    expect(spent).toBe(0);
  });

  it("includes a call recorded earlier the same month", async () => {
    const db = await testDb();
    await recordCall(
      {
        taskKind: "generate",
        provider: "anthropic",
        model: "claude-sonnet-5",
        usage: { ...EMPTY_USAGE, outputTokens: 1_000_000 },
      },
      db,
    );

    const spent = await monthSpendUsd(db, new Date("2026-03-31T23:59:59Z"));
    expect(spent).toBeCloseTo(15, 5);
  });

  it("returns zero with no rows at all", async () => {
    const db = await testDb();
    expect(await monthSpendUsd(db)).toBe(0);
  });

  it("scopes to one account when a userId is passed, since each account now spends on its own key", async () => {
    const db = await testDb();
    await makeUser(db, "user-a");
    await makeUser(db, "user-b");
    await recordCall(
      { taskKind: "diagnose", provider: "anthropic", model: "claude-opus-5", usage: { ...EMPTY_USAGE, inputTokens: 1_000_000 }, userId: "user-a" },
      db,
    );
    await recordCall(
      { taskKind: "diagnose", provider: "anthropic", model: "claude-opus-5", usage: { ...EMPTY_USAGE, inputTokens: 2_000_000 }, userId: "user-b" },
      db,
    );

    expect(await monthSpendUsd(db, undefined, "user-a")).toBeCloseTo(15, 5);
    expect(await monthSpendUsd(db, undefined, "user-b")).toBeCloseTo(30, 5);
    expect(await monthSpendUsd(db)).toBeCloseTo(45, 5);
  });
});

describe("assertWithinBudget", () => {
  it("does not throw while under the configured monthly ceiling", async () => {
    const db = await testDb();
    await saveSettings({ LLM_MONTHLY_BUDGET_USD: "10" }, db);
    await recordCall(
      { taskKind: "diagnose", provider: "anthropic", model: "claude-haiku-4-5", usage: { ...EMPTY_USAGE, inputTokens: 1_000_000 } },
      db,
    );

    await expect(assertWithinBudget(db)).resolves.toBeUndefined();
  });

  it("throws an LLMError classified as budget_exceeded once spend meets the ceiling", async () => {
    const db = await testDb();
    await saveSettings({ LLM_MONTHLY_BUDGET_USD: "1" }, db);
    await recordCall(
      { taskKind: "diagnose", provider: "anthropic", model: "claude-opus-5", usage: { ...EMPTY_USAGE, inputTokens: 1_000_000 } },
      db,
    );

    const error = await assertWithinBudget(db).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect((error as LLMError).failure).toBe("budget_exceeded");
  });

  it("does not let one account's spend block a different account under the same ceiling", async () => {
    // Each account now calls the model on its own API key (core/auth/users.ts),
    // so an instance-wide ceiling would be the wrong thing to check here — see
    // the comment on assertWithinBudget itself.
    const db = await testDb();
    await makeUser(db, "user-a");
    await makeUser(db, "user-b");
    await saveSettings({ LLM_MONTHLY_BUDGET_USD: "1" }, db);
    await recordCall(
      { taskKind: "diagnose", provider: "anthropic", model: "claude-opus-5", usage: { ...EMPTY_USAGE, inputTokens: 1_000_000 }, userId: "user-a" },
      db,
    );

    await expect(
      runInRequestScope({ requestId: "req-1", userId: "user-b" }, () => assertWithinBudget(db)),
    ).resolves.toBeUndefined();

    const error = await runInRequestScope({ requestId: "req-2", userId: "user-a" }, () =>
      assertWithinBudget(db).catch((e: unknown) => e),
    );
    expect(error).toBeInstanceOf(LLMError);
  });
});

describe("withBudgetGuard", () => {
  function fakeProvider(model = "claude-opus-5"): LLMProvider {
    // Cast rather than satisfy LLMProvider's generic method signatures
    // exactly: this double only ever stands in for one concrete call shape
    // per test, and the generic is `completeStructured`'s contract with real
    // callers, not something a fixed test double can express faithfully.
    return {
      name: "anthropic",
      model,
      health: vi.fn(),
      completeText: vi.fn(async () => ({
        value: "ok",
        usage: { ...EMPTY_USAGE, inputTokens: 100 },
        model,
      })),
      completeStructured: vi.fn(async () => ({
        value: { ok: true },
        usage: { ...EMPTY_USAGE, inputTokens: 100 },
        model,
      })),
    } as unknown as LLMProvider;
  }

  it("refuses to call the underlying provider once the budget is already spent", async () => {
    const db = await testDb();
    await saveSettings({ LLM_MONTHLY_BUDGET_USD: "1" }, db);
    await recordCall(
      { taskKind: "diagnose", provider: "anthropic", model: "claude-opus-5", usage: { ...EMPTY_USAGE, inputTokens: 1_000_000 } },
      db,
    );

    const inner = fakeProvider();
    const guarded = withBudgetGuard(inner, db);

    await expect(
      guarded.completeStructured({ kind: "diagnose", system: "s", user: "u", schema: undefined as never, schemaName: "x" }),
    ).rejects.toMatchObject({ failure: "budget_exceeded" });

    expect(inner.completeStructured).not.toHaveBeenCalled();
  });

  it("calls through and records spend when under budget", async () => {
    const db = await testDb();
    await saveSettings({ LLM_MONTHLY_BUDGET_USD: "1000" }, db);

    const inner = fakeProvider();
    const guarded = withBudgetGuard(inner, db);

    await guarded.completeStructured({
      kind: "diagnose",
      system: "s",
      user: "u",
      schema: undefined as never,
      schemaName: "x",
    });

    expect(inner.completeStructured).toHaveBeenCalledTimes(1);
    expect(await monthSpendUsd(db)).toBeGreaterThan(0);
  });
});
