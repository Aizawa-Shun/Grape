import { describe, expect, it } from "vitest";

import { SESSION_TTL_SEC, isLoopbackHost, issueSession, readSession, sessionSecret } from "./session";

const SECRET = "test-secret";
const NOW = 1_800_000_000;
const USER = "3f1c2a90-0000-4000-8000-000000000001";

describe("session", () => {
  it("carries the subject back out of a token it just issued", async () => {
    const token = await issueSession(SECRET, USER, NOW);

    expect(await readSession(token, SECRET, NOW)).toEqual({
      valid: true,
      userId: USER,
      shouldRenew: false,
    });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await issueSession(SECRET, USER, NOW);

    expect((await readSession(token, "other-secret", NOW)).valid).toBe(false);
  });

  /**
   * The reason the subject is inside the signature rather than beside it: a
   * token that named its account in the clear would let any logged-in person
   * become any other by editing one field of their own cookie.
   */
  it("rejects a token whose subject has been swapped for someone else's", async () => {
    const token = await issueSession(SECRET, USER, NOW);
    const forged = token.replace(USER, "3f1c2a90-0000-4000-8000-000000000002");

    expect(forged).not.toBe(token);
    expect((await readSession(forged, SECRET, NOW)).valid).toBe(false);
  });

  it("rejects a tampered expiry", async () => {
    const token = await issueSession(SECRET, USER, NOW);
    const signature = token.slice(token.lastIndexOf(".") + 1);
    const forged = `v2.${USER}.${NOW + 10 * SESSION_TTL_SEC}.${signature}`;

    expect((await readSession(forged, SECRET, NOW)).valid).toBe(false);
  });

  it("rejects an expired token", async () => {
    const token = await issueSession(SECRET, USER, NOW);

    expect((await readSession(token, SECRET, NOW + SESSION_TTL_SEC + 1)).valid).toBe(false);
  });

  it("asks to be renewed once it is close to expiring", async () => {
    const token = await issueSession(SECRET, USER, NOW);
    const nearlyExpired = NOW + SESSION_TTL_SEC - 60;

    expect(await readSession(token, SECRET, nearlyExpired)).toEqual({
      valid: true,
      userId: USER,
      shouldRenew: true,
    });
  });

  /**
   * Cookies issued by the single-password design are `<exp>.<sig>` and name
   * nobody. They must fail rather than be reinterpreted — there is no account
   * they could honestly be read as belonging to.
   */
  it("rejects a session issued before accounts existed", async () => {
    const legacy = `${NOW + SESSION_TTL_SEC}.c2lnbmF0dXJl`;

    expect((await readSession(legacy, SECRET, NOW)).valid).toBe(false);
  });

  it("rejects missing and malformed tokens without throwing", async () => {
    for (const token of [undefined, "", "garbage", ".", "abc.def", "123.", "v2..123.sig", "v3.u.1.sig"]) {
      expect((await readSession(token, SECRET, NOW)).valid, String(token)).toBe(false);
    }
  });
});

/**
 * The Host header carries a port and the allow-list does not, so the whole
 * question is whether the port is stripped. It is the only thing standing
 * between "a fresh checkout runs with no configuration" and "the developer
 * fallback never fires", and it is invisible from either side unless asserted.
 */
describe("isLoopbackHost", () => {
  it.each([
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:8080",
    "[::1]",
    "[::1]:3000",
    "::1",
  ])(
    "recognises %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each([undefined, null, "", "grape.example.com", "grape.example.com:3000", "localhost.example.com"])(
    "does not recognise %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe("sessionSecret", () => {
  it("prefers an explicitly configured secret, even on a developer machine", () => {
    expect(sessionSecret("explicit", true)).toBe("explicit");
  });

  it("has no secret when nothing is configured and this is not a local dev request", () => {
    expect(sessionSecret(undefined, false)).toBeNull();
  });

  /**
   * What keeps a fresh checkout running with no setup. Stable across calls
   * because the Edge proxy and the Node routes have to agree on it.
   */
  it("falls back to a fixed developer key so a fresh checkout needs no configuration", () => {
    const secret = sessionSecret(undefined, true);

    expect(secret).toBeTruthy();
    expect(secret).toBe(sessionSecret(undefined, true));
  });
});
