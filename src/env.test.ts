import { describe, expect, it } from "vitest";

import { isLocalHost, parseEnv } from "./env";

describe("parseEnv", () => {
  it("runs on defaults alone, so a fresh checkout starts without configuration", () => {
    const env = parseEnv({});

    expect(env.DATABASE_URL).toBe("file:./grape.db");
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

  it("allows neither GOOGLE_CLIENT_ID nor GOOGLE_CLIENT_SECRET, the ordinary no-Google-login case", () => {
    expect(() => parseEnv({})).not.toThrow();
  });

  it("allows both together, which is what turns Google sign-in on", () => {
    const env = parseEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
    expect(env.GOOGLE_CLIENT_ID).toBe("id");
  });

  /**
   * Half a pair would show a "Googleでログイン" button that fails every
   * attempt against Google with "invalid_client" — worse than one that never
   * appears, since the operator sees nothing wrong until someone clicks it.
   */
  it.each(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"])("refuses %s alone", (onlyThis) => {
    expect(() => parseEnv({ [onlyThis]: "only-one-half" })).toThrow(/GOOGLE_CLIENT/);
  });

  it("trims whitespace pasted around DATABASE_AUTH_TOKEN and DATABASE_URL", () => {
    const env = parseEnv({ DATABASE_URL: " file:./grape.db \n", DATABASE_AUTH_TOKEN: " a-token\n" });
    expect(env.DATABASE_URL).toBe("file:./grape.db");
    expect(env.DATABASE_AUTH_TOKEN).toBe("a-token");
  });
});
