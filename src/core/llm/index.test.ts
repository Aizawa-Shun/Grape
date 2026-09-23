import { afterEach, describe, expect, it, vi } from "vitest";

import type { LLMProviderName } from "@/env";

/**
 * `getProvider()` reads three things that used to be trivial to construct by
 * hand — settings, the ambient signed-in account, and now a per-account API
 * key from the database — so all three are mocked here rather than exercised
 * for real. `vi.hoisted` is required (not a plain top-level `let`) because
 * `vi.mock` factories run before the rest of this file, and referencing an
 * un-hoisted binding from inside one throws at import time.
 */
const state = vi.hoisted(() => ({
  settings: {
    LLM_PROVIDER: undefined as LLMProviderName | undefined,
    ANTHROPIC_MODEL: "claude-opus-5",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    OPENAI_MODEL: "gpt-4o-mini",
    LLM_TIMEOUT_MS: 1_000,
    LLM_HEALTH_TIMEOUT_MS: 1_000,
    LLM_MAX_REPAIRS: 1,
  },
  userId: undefined as string | undefined,
  // Keyed "<userId>:<provider>" — a fake of core/auth/users.ts's own store.
  apiKeys: {} as Record<string, string>,
}));

vi.mock("@/core/settings", () => ({ currentSettings: () => state.settings }));
vi.mock("@/server/context", () => ({ currentUserId: () => state.userId }));
vi.mock("@/core/auth/users", () => ({
  getLlmApiKey: async (userId: string, provider: LLMProviderName) =>
    state.apiKeys[`${userId}:${provider}`],
}));

afterEach(() => {
  vi.resetModules();
  state.settings.LLM_PROVIDER = undefined;
  state.settings.OPENAI_BASE_URL = "https://api.openai.com/v1";
  state.userId = undefined;
  state.apiKeys = {};
});

describe("getProvider", () => {
  it("throws LLM_NOT_CONFIGURED when the instance has not picked a service", async () => {
    const { getProvider } = await import("./index");
    await expect(getProvider()).rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED" });
  });

  it("throws LLM_NOT_CONFIGURED when nobody is signed in", async () => {
    state.settings.LLM_PROVIDER = "anthropic";
    const { getProvider } = await import("./index");
    await expect(getProvider()).rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED" });
  });

  it("throws LLM_NOT_CONFIGURED when the signed-in account has not added its own key", async () => {
    state.settings.LLM_PROVIDER = "anthropic";
    state.userId = "user-a";
    const { getProvider } = await import("./index");
    await expect(getProvider()).rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED" });
  });

  it("builds a provider once the signed-in account has its own key", async () => {
    state.settings.LLM_PROVIDER = "anthropic";
    state.userId = "user-a";
    state.apiKeys["user-a:anthropic"] = "sk-ant-test";

    const { getProvider } = await import("./index");
    const provider = await getProvider();
    expect(provider.name).toBe("anthropic");
  });

  it("needs no key for a local openai-compat endpoint, since a self-hosted server has none to give", async () => {
    state.settings.LLM_PROVIDER = "openai-compat";
    state.settings.OPENAI_BASE_URL = "http://localhost:1234/v1";
    state.userId = "user-a";

    const { getProvider } = await import("./index");
    const provider = await getProvider();
    expect(provider.name).toBe("openai-compat");
  });

  it("still requires a key for a remote openai-compat endpoint", async () => {
    state.settings.LLM_PROVIDER = "openai-compat";
    state.settings.OPENAI_BASE_URL = "https://api.openai.com/v1";
    state.userId = "user-a";

    const { getProvider } = await import("./index");
    await expect(getProvider()).rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED" });
  });

  it("never hands one account's cached provider to another", async () => {
    state.settings.LLM_PROVIDER = "anthropic";
    state.apiKeys["user-a:anthropic"] = "sk-ant-a";
    state.apiKeys["user-b:anthropic"] = "sk-ant-b";

    const { getProvider } = await import("./index");

    state.userId = "user-a";
    const providerA = await getProvider();

    state.userId = "user-b";
    const providerB = await getProvider();

    expect(providerA).not.toBe(providerB);
  });

  it("caches the same account's provider across calls instead of rebuilding it", async () => {
    state.settings.LLM_PROVIDER = "anthropic";
    state.userId = "user-a";
    state.apiKeys["user-a:anthropic"] = "sk-ant-a";

    const { getProvider } = await import("./index");
    expect(await getProvider()).toBe(await getProvider());
  });
});
