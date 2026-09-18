import { describe, expect, it } from "vitest";

import { OVERRIDABLE_KEYS, isOverridable, publicSettings, resolveSettings } from "./index";

describe("OVERRIDABLE_KEYS", () => {
  it("excludes every secret, so an auth bypass cannot read or rewrite one", () => {
    for (const secret of [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GRAPE_SESSION_SECRET",
      "X_CONSUMER_KEY",
      "X_CONSUMER_SECRET",
      "X_ACCESS_TOKEN",
      "X_ACCESS_TOKEN_SECRET",
      "DATABASE_URL",
    ]) {
      expect(isOverridable(secret), secret).toBe(false);
    }
  });

  it("allows the dry-run flag, which has its own confirm-gated control rather than the generic form", () => {
    // Overridable so /settings can offer it at all, but settings-form.tsx never
    // lists it among the generic fields — see settings/dry-run-toggle.tsx,
    // which is the only path that is allowed to write this key and does so
    // behind a window.confirm, not a batched save.
    expect(isOverridable("GRAPE_ACTION_DRY_RUN")).toBe(true);
  });

  it("covers the operational settings someone would actually want to change", () => {
    expect(OVERRIDABLE_KEYS).toContain("LLM_PROVIDER");
    expect(OVERRIDABLE_KEYS).toContain("OPENAI_MODEL");
    expect(OVERRIDABLE_KEYS).toContain("INGEST_BASE_URL");
  });
});

describe("resolveSettings", () => {
  it("falls back to the environment when nothing is overridden", () => {
    const settings = resolveSettings({ OPENAI_MODEL: "from-env" }, {});

    expect(settings.OPENAI_MODEL).toBe("from-env");
  });

  it("lets a stored value win over the file", () => {
    const settings = resolveSettings({ OPENAI_MODEL: "from-env" }, { OPENAI_MODEL: "from-db" });

    expect(settings.OPENAI_MODEL).toBe("from-db");
  });

  it("applies the env schema's coercion to a value typed into the browser", () => {
    const settings = resolveSettings({}, { COLD_START_MIN_SESSIONS: "45" });

    expect(settings.COLD_START_MIN_SESSIONS).toBe(45);
  });

  it("rejects a malformed URL the same way the file would", () => {
    // The point of reusing parseEnv: this rule is written once.
    expect(() => resolveSettings({}, { OPENAI_BASE_URL: "localhost:11434" })).toThrow(
      /OPENAI_BASE_URL/,
    );
  });

  it("rejects a provider name that is not one of the two", () => {
    expect(() => resolveSettings({}, { LLM_PROVIDER: "gpt5" })).toThrow(/LLM_PROVIDER/);
  });

  it("refuses anthropic from the web with no key configured, the same as the file would", () => {
    expect(() => resolveSettings({}, { LLM_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() =>
      resolveSettings({ ANTHROPIC_API_KEY: "sk-ant-test" }, { LLM_PROVIDER: "anthropic" }),
    ).not.toThrow();
  });

  it("still enforces the cross-field rule that involves a secret it cannot set", () => {
    // Switching to a remote openai-compat endpoint from the web is refused
    // when the key it needs is not in .env, rather than silently producing a
    // configuration that cannot work.
    expect(() =>
      resolveSettings({}, { LLM_PROVIDER: "openai-compat", OPENAI_BASE_URL: "https://api.openai.com/v1" }),
    ).toThrow(/OPENAI_API_KEY/);

    expect(() =>
      resolveSettings(
        { OPENAI_API_KEY: "sk-test" },
        { LLM_PROVIDER: "openai-compat", OPENAI_BASE_URL: "https://api.openai.com/v1" },
      ),
    ).not.toThrow();
  });

  it("ignores a key that is not overridable, even if one is stored", () => {
    const settings = resolveSettings(
      { ANTHROPIC_API_KEY: "sk-ant-from-env" },
      { ANTHROPIC_API_KEY: "sk-ant-from-db" } as never,
    );

    expect(settings.ANTHROPIC_API_KEY).toBe("sk-ant-from-env");
  });

  it("lets a stored value flip the dry-run flag, same as any other overridable key", () => {
    const settings = resolveSettings(
      { GRAPE_ACTION_DRY_RUN: "true" },
      { GRAPE_ACTION_DRY_RUN: "false" },
    );

    expect(settings.GRAPE_ACTION_DRY_RUN).toBe(false);
  });
});

describe("publicSettings", () => {
  it("carries no secret, whatever else is on the object", () => {
    const settings = resolveSettings(
      {
        ANTHROPIC_API_KEY: "sk-ant-should-never-leave",
        OPENAI_API_KEY: "sk-openai-secret",
        GRAPE_SESSION_SECRET: "signing-key",
        X_CONSUMER_SECRET: "x-secret",
        DATABASE_URL: "file:./grape.db",
      },
      {},
    );

    const serialized = JSON.stringify(publicSettings(settings));

    for (const secret of [
      "sk-ant-should-never-leave",
      "sk-openai-secret",
      "signing-key",
      "x-secret",
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }
  });

  it("carries every key the settings screen is allowed to edit", () => {
    const values = publicSettings(resolveSettings({}, {}));

    expect(Object.keys(values).sort()).toEqual([...OVERRIDABLE_KEYS].sort());
  });
});
