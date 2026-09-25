import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { GRAPE_ENCRYPTION_KEY: undefined as string | undefined },
}));

afterEach(() => {
  vi.resetModules();
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext API key", async () => {
    const { env } = await import("@/env");
    env.GRAPE_ENCRYPTION_KEY = "test-secret";

    const { encryptSecret, decryptSecret } = await import("./secret-box");
    const ciphertext = encryptSecret("sk-ant-abc123");

    expect(ciphertext).not.toContain("sk-ant-abc123");
    expect(decryptSecret(ciphertext)).toBe("sk-ant-abc123");
  });

  it("produces a different ciphertext each time, so two rows never look identical", async () => {
    const { env } = await import("@/env");
    env.GRAPE_ENCRYPTION_KEY = "test-secret";

    const { encryptSecret } = await import("./secret-box");
    expect(encryptSecret("sk-ant-abc123")).not.toBe(encryptSecret("sk-ant-abc123"));
  });

  it("fails to decrypt once GRAPE_ENCRYPTION_KEY changes underneath it", async () => {
    const { env } = await import("@/env");
    env.GRAPE_ENCRYPTION_KEY = "first-secret";
    const { encryptSecret, decryptSecret } = await import("./secret-box");
    const ciphertext = encryptSecret("sk-ant-abc123");

    env.GRAPE_ENCRYPTION_KEY = "second-secret";
    expect(() => decryptSecret(ciphertext)).toThrow();
  });

  it("falls back to the well-known development secret when unset, in development", async () => {
    const { env } = await import("@/env");
    env.GRAPE_ENCRYPTION_KEY = undefined;

    const { encryptSecret, decryptSecret } = await import("./secret-box");
    const ciphertext = encryptSecret("sk-ant-abc123");

    expect(decryptSecret(ciphertext)).toBe("sk-ant-abc123");
  });
});
