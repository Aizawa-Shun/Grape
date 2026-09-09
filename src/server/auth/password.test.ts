import { describe, expect, it } from "vitest";

import { hashPassword, verifyDummy, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("accepts the password it was given", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery stapl", stored)).toBe(false);
  });

  it("salts, so the same password never produces the same hash twice", async () => {
    const [a, b] = [await hashPassword("same"), await hashPassword("same")];
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("carries its cost parameters, so they can be raised without invalidating old hashes", async () => {
    const stored = await hashPassword("x");
    expect(stored.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(stored.split("$")).toHaveLength(6);
  });

  /**
   * A hash this function cannot read must be a closed door, not an open one:
   * every one of these is a corrupt or truncated row, and returning true for
   * any of them would turn a storage bug into an authentication bypass.
   */
  it.each([
    ["empty", ""],
    ["not scrypt", "argon2$16384$8$1$c2FsdA==$a2V5"],
    ["too few fields", "scrypt$16384$8$1$c2FsdA=="],
    ["truncated to the salt", "scrypt$16384$8$1$c2FsdA==$"],
    ["non-numeric cost", "scrypt$abc$8$1$c2FsdA==$a2V5"],
    ["zero cost", "scrypt$0$8$1$c2FsdA==$a2V5"],
  ])("rejects a malformed stored hash (%s)", async (_label, stored) => {
    expect(await verifyPassword("anything", stored)).toBe(false);
  });

  it("rejects a hash whose key has been truncated", async () => {
    const stored = await hashPassword("secret");
    const parts = stored.split("$");
    const shortened = Buffer.from(parts[5], "base64").subarray(0, 32).toString("base64");
    expect(await verifyPassword("secret", [...parts.slice(0, 5), shortened].join("$"))).toBe(false);
  });
});

describe("verifyDummy", () => {
  it("always fails", async () => {
    expect(await verifyDummy("anything at all")).toBe(false);
  });

  /**
   * The whole point of verifyDummy is the time it spends. If its built-in hash
   * were ever malformed it would fail to parse and return in microseconds —
   * still false, still passing the test above, while silently reintroducing
   * the timing difference that says "no such account". Only the clock catches
   * that, so the clock is what this asserts.
   */
  it("actually performs a derivation rather than failing to parse", async () => {
    const started = performance.now();
    await verifyDummy("anything at all");
    expect(performance.now() - started).toBeGreaterThan(5);
  });
});
