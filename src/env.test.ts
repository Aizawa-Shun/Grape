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

  /**
   * The deployed default. Left to the plain fallback, a Render instance hands
   * out a snippet pointing at localhost, which fails silently in every visitor's
   * browser — the one misconfiguration that produces no error anywhere.
   */
  it("takes the ingest origin from the host's own public URL when one is offered", () => {
    const env = parseEnv({ RENDER_EXTERNAL_URL: "https://grape.onrender.com" });

    expect(env.INGEST_BASE_URL).toBe("https://grape.onrender.com");
  });

  it("lets an explicit ingest origin beat the host's, so a custom domain wins", () => {
    const env = parseEnv({
      RENDER_EXTERNAL_URL: "https://grape.onrender.com",
      INGEST_BASE_URL: "https://grape.example.com",
    });

    expect(env.INGEST_BASE_URL).toBe("https://grape.example.com");
  });

  it("still falls back to localhost off a host that offers nothing", () => {
    expect(parseEnv({}).INGEST_BASE_URL).toBe("http://localhost:3000");
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
