import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("runs on defaults alone, so a fresh checkout starts without configuration", () => {
    const env = parseEnv({});

    expect(env.DATABASE_URL).toBe("file:./grape.db");
    expect(env.LLM_PROVIDER).toBe("anthropic");
    expect(env.COLD_START_MIN_SESSIONS).toBe(30);
  });

  it("treats a blank value as absent rather than letting it beat the default", () => {
    expect(parseEnv({ OLLAMA_MODEL: "   " }).OLLAMA_MODEL).toBe("qwen2.5:1.5b-instruct");
  });

  it("rejects a malformed URL at boot instead of at the first request", () => {
    expect(() => parseEnv({ OLLAMA_BASE_URL: "localhost:11434" })).toThrow(/OLLAMA_BASE_URL/);
  });

  it("keeps dry run on unless the value is exactly false", () => {
    expect(parseEnv({}).GRAPE_ACTION_DRY_RUN).toBe(true);
    expect(parseEnv({ GRAPE_ACTION_DRY_RUN: "true" }).GRAPE_ACTION_DRY_RUN).toBe(true);
    expect(parseEnv({ GRAPE_ACTION_DRY_RUN: "FALSE " }).GRAPE_ACTION_DRY_RUN).toBe(false);
    // A typo must never be read as permission to publish.
    expect(parseEnv({ GRAPE_ACTION_DRY_RUN: "flase" }).GRAPE_ACTION_DRY_RUN).toBe(true);
    expect(parseEnv({ GRAPE_ACTION_DRY_RUN: "0" }).GRAPE_ACTION_DRY_RUN).toBe(true);
  });

  it("refuses a remote openai-compat endpoint with no key, which cannot work", () => {
    expect(() =>
      parseEnv({ LLM_PROVIDER: "openai-compat", OPENAI_BASE_URL: "https://api.openai.com/v1" }),
    ).toThrow(/OPENAI_API_KEY/);
  });

  it("allows a local openai-compat endpoint with no key, because LM Studio needs none", () => {
    const env = parseEnv({
      LLM_PROVIDER: "openai-compat",
      OPENAI_BASE_URL: "http://localhost:1234/v1",
    });

    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("does not require ANTHROPIC_API_KEY, since `ant auth login` is invisible to env", () => {
    expect(() => parseEnv({ LLM_PROVIDER: "anthropic" })).not.toThrow();
  });
});
