import { describe, expect, it } from "vitest";

import { isLocalHost, parseEnv } from "./env";

describe("parseEnv", () => {
  it("runs on defaults alone, so a fresh checkout starts without configuration", () => {
    const env = parseEnv({});

    expect(env.LLM_PROVIDER).toBeUndefined();
    expect(env.COLD_START_MIN_SESSIONS).toBe(30);
  });

  it("treats a blank value as absent rather than letting it beat the default", () => {
    expect(parseEnv({ OPENAI_MODEL: "   " }).OPENAI_MODEL).toBe("gpt-4o-mini");
  });

  it("leaves AI off by default — a fresh checkout is not quietly running against a model", () => {
    expect(parseEnv({}).LLM_PROVIDER).toBeUndefined();
  });

  it("allows anthropic on its own, with no instance-wide key to check any more", () => {
    // API keys moved out of Env and into a per-account column (see
    // core/auth/users.ts) — LLM_PROVIDER only says which service is in play,
    // not who can actually call it, so the schema has nothing left to refuse.
    expect(() => parseEnv({ LLM_PROVIDER: "anthropic" })).not.toThrow();
  });

  it("still falls back to localhost off a host that offers nothing", () => {
    expect(parseEnv({}).INGEST_BASE_URL).toBe("http://localhost:3000");
  });

  it("rejects a malformed URL at boot instead of at the first request", () => {
    expect(() => parseEnv({ OPENAI_BASE_URL: "localhost:1234" })).toThrow(/OPENAI_BASE_URL/);
  });

  it("keeps dry run on unless the value is exactly false", () => {
    expect(parseEnv({}).GRAPE_ACTION_DRY_RUN).toBe(true);
    expect(parseEnv({ GRAPE_ACTION_DRY_RUN: "true" }).GRAPE_ACTION_DRY_RUN).toBe(true);
    expect(parseEnv({ GRAPE_ACTION_DRY_RUN: "FALSE " }).GRAPE_ACTION_DRY_RUN).toBe(false);
    // A typo must never be read as permission to publish.
    expect(parseEnv({ GRAPE_ACTION_DRY_RUN: "flase" }).GRAPE_ACTION_DRY_RUN).toBe(true);
    expect(parseEnv({ GRAPE_ACTION_DRY_RUN: "0" }).GRAPE_ACTION_DRY_RUN).toBe(true);
  });

  it("allows a remote openai-compat endpoint on its own, same as anthropic above", () => {
    expect(() =>
      parseEnv({ LLM_PROVIDER: "openai-compat", OPENAI_BASE_URL: "https://api.openai.com/v1" }),
    ).not.toThrow();
  });

  describe("isLocalHost", () => {
    it("recognises every loopback spelling getProvider's openai-compat exemption relies on", () => {
      for (const url of [
        "http://localhost:1234/v1",
        "http://127.0.0.1:1234/v1",
        "http://[::1]:1234/v1",
      ]) {
        expect(isLocalHost(url), url).toBe(true);
      }
    });

    it("does not treat a real host as local", () => {
      expect(isLocalHost("https://api.openai.com/v1")).toBe(false);
    });
  });

  it("trims whitespace pasted around the secrets", () => {
    const env = parseEnv({
      GRAPE_ENCRYPTION_KEY: " a-long-encryption-key\n",
      GRAPE_CRON_SECRET: " a-long-cron-secret-value \n",
    });
    expect(env.GRAPE_ENCRYPTION_KEY).toBe("a-long-encryption-key");
    expect(env.GRAPE_CRON_SECRET).toBe("a-long-cron-secret-value");
  });

  /** A short secret is one someone typed as a placeholder, not one they generated. */
  it("refuses an encryption key or cron secret shorter than 16 characters", () => {
    expect(() => parseEnv({ GRAPE_ENCRYPTION_KEY: "short" })).toThrow(/GRAPE_ENCRYPTION_KEY/);
    expect(() => parseEnv({ GRAPE_CRON_SECRET: "short" })).toThrow(/GRAPE_CRON_SECRET/);
  });
});
