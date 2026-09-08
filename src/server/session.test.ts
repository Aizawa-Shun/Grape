import { describe, expect, it } from "vitest";

import { SESSION_TTL_SEC, issueSession, readSession, sessionSecret } from "./session";

const SECRET = "test-secret";
const NOW = 1_800_000_000;

describe("session", () => {
  it("accepts a token it just issued", async () => {
    const token = await issueSession(SECRET, NOW);

    expect(await readSession(token, SECRET, NOW)).toEqual({ valid: true, shouldRenew: false });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await issueSession(SECRET, NOW);

    expect((await readSession(token, "other-secret", NOW)).valid).toBe(false);
  });

  it("rejects a tampered expiry, which is the only thing worth forging", async () => {
    const token = await issueSession(SECRET, NOW);
    const [, signature] = token.split(".");
    const forged = `${NOW + 10 * SESSION_TTL_SEC}.${signature}`;

    expect((await readSession(forged, SECRET, NOW)).valid).toBe(false);
  });

  it("rejects an expired token", async () => {
    const token = await issueSession(SECRET, NOW);

    expect((await readSession(token, SECRET, NOW + SESSION_TTL_SEC + 1)).valid).toBe(false);
  });

  it("asks to be renewed once it is close to expiring", async () => {
    const token = await issueSession(SECRET, NOW);
    const nearlyExpired = NOW + SESSION_TTL_SEC - 60;

    expect(await readSession(token, SECRET, nearlyExpired)).toEqual({
      valid: true,
      shouldRenew: true,
    });
  });

  it("rejects missing and malformed tokens without throwing", async () => {
    for (const token of [undefined, "", "garbage", ".", "abc.def", "123."]) {
      expect((await readSession(token, SECRET, NOW)).valid, String(token)).toBe(false);
    }
  });
});

describe("sessionSecret", () => {
  it("has no secret when nothing is configured, which is what enables localhost-only mode", async () => {
    expect(await sessionSecret(undefined, undefined)).toBeNull();
  });

  it("derives from the password so one variable is enough to get started", async () => {
    const secret = await sessionSecret(undefined, "hunter2");

    expect(secret).toBeTruthy();
    expect(secret).toBe(await sessionSecret(undefined, "hunter2"));
  });

  it("invalidates every session when the password changes", async () => {
    const before = await sessionSecret(undefined, "hunter2");
    const after = await sessionSecret(undefined, "hunter3");

    expect(before).not.toBe(after);
  });

  it("prefers an explicit secret over the derived one", async () => {
    expect(await sessionSecret("explicit", "hunter2")).toBe("explicit");
  });
});
