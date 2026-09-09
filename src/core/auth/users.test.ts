import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import type { Database } from "@/db/client";

import { accountsExist, createInvite, redeemInvite, registerFirstUser } from "./users";

/**
 * A real migrated database rather than a mock: what is under test is a
 * transaction, a unique constraint and two UPDATE statements, none of which a
 * fake would exercise.
 */
async function testDb(): Promise<Database> {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db as unknown as Database;
}

const ACCOUNT = {
  email: "owner@example.com",
  displayName: "Owner",
  password: "a-sufficiently-long-password",
};

describe("registerFirstUser", () => {
  it("makes the first person the owner", async () => {
    const db = await testDb();
    const user = await registerFirstUser(ACCOUNT, db);

    expect(user.role).toBe("owner");
    expect(user.email).toBe("owner@example.com");
    expect(await accountsExist(db)).toBe(true);
  });

  it("lower-cases the address, so it cannot be registered twice in different cases", async () => {
    const db = await testDb();
    const user = await registerFirstUser({ ...ACCOUNT, email: "  Owner@Example.COM " }, db);

    expect(user.email).toBe("owner@example.com");
  });

  it("never stores the password itself", async () => {
    const db = await testDb();
    const user = await registerFirstUser(ACCOUNT, db);

    expect(user.passwordHash).not.toContain(ACCOUNT.password);
    expect(user.passwordHash.startsWith("scrypt$")).toBe(true);
  });

  /**
   * The reason adoption happens inside registration rather than in a
   * migration: which account owns the pre-account rows is only knowable at the
   * moment somebody claims the instance.
   */
  it("adopts the products and model calls that predate accounts", async () => {
    const db = await testDb();
    await db.insert(schema.products).values({
      id: "p1",
      userId: schema.LOCAL_USER,
      url: "https://example.com",
      name: "example",
    });
    await db.insert(schema.llmCalls).values({
      taskKind: "diagnose",
      provider: "anthropic",
      model: "claude-opus-5",
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0.01,
    });

    const owner = await registerFirstUser(ACCOUNT, db);

    const product = await db.query.products.findFirst({ where: eq(schema.products.id, "p1") });
    const [call] = await db.select().from(schema.llmCalls);
    expect(product?.userId).toBe(owner.id);
    expect(call.userId).toBe(owner.id);
  });

  it("closes once an account exists", async () => {
    const db = await testDb();
    await registerFirstUser(ACCOUNT, db);

    await expect(
      registerFirstUser({ ...ACCOUNT, email: "second@example.com" }, db),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it.each([
    ["not an address", { email: "nope" }],
    ["blank display name", { displayName: "   " }],
    ["password below the minimum", { password: "short" }],
  ])("refuses %s", async (_label, override) => {
    const db = await testDb();

    await expect(registerFirstUser({ ...ACCOUNT, ...override }, db)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

describe("invites", () => {
  const GUEST = {
    email: "guest@example.com",
    displayName: "Guest",
    password: "another-long-enough-password",
  };

  async function withOwner() {
    const db = await testDb();
    const owner = await registerFirstUser(ACCOUNT, db);
    return { db, owner };
  }

  it("lets a code from the owner create a member", async () => {
    const { db, owner } = await withOwner();
    const { code } = await createInvite(owner.id, db);

    const guest = await redeemInvite(code, GUEST, db);
    expect(guest.role).toBe("member");
  });

  it("stores only a hash, never the code", async () => {
    const { db, owner } = await withOwner();
    const { code } = await createInvite(owner.id, db);

    const [row] = await db.select().from(schema.invites);
    expect(row.codeHash).not.toBe(code);
    expect(row.codeHash).toHaveLength(64);
  });

  it("cannot be redeemed twice", async () => {
    const { db, owner } = await withOwner();
    const { code } = await createInvite(owner.id, db);
    await redeemInvite(code, GUEST, db);

    await expect(
      redeemInvite(code, { ...GUEST, email: "third@example.com" }, db),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("expires", async () => {
    const { db, owner } = await withOwner();
    const issued = new Date("2026-01-01T00:00:00Z");
    const { code } = await createInvite(owner.id, db, issued);

    await expect(
      redeemInvite(code, GUEST, db, new Date("2026-02-01T00:00:00Z")),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  /**
   * Unknown, expired and already-used all fail identically. Telling them apart
   * would let someone probing codes learn which guesses were real, and none of
   * the three is separately actionable for the person holding the code.
   */
  it("refuses a code that was never issued", async () => {
    const { db } = await withOwner();

    await expect(redeemInvite("NOTAREALCODE00000000000000", GUEST, db)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  /**
   * The unique index is the guard, not a look-before-you-insert check, so this
   * pins that its violation comes back as something a person can read rather
   * than as the driver's constraint message.
   */
  it("refuses an address that is already registered", async () => {
    const { db, owner } = await withOwner();
    const { code } = await createInvite(owner.id, db);

    await expect(
      redeemInvite(code, { ...GUEST, email: ACCOUNT.email }, db),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  /**
   * A rejected registration must not burn the code: the invited person still
   * needs it, and asking the owner for a new one because of their own typo is
   * the kind of dead end nobody can diagnose.
   */
  it("leaves the code unused when the registration itself fails", async () => {
    const { db, owner } = await withOwner();
    const { code } = await createInvite(owner.id, db);
    await expect(redeemInvite(code, { ...GUEST, email: ACCOUNT.email }, db)).rejects.toThrow();

    const guest = await redeemInvite(code, GUEST, db);
    expect(guest.email).toBe(GUEST.email);
  });

  it("does not create the account when the code is refused", async () => {
    const { db } = await withOwner();
    await expect(redeemInvite("NOTAREALCODE00000000000000", GUEST, db)).rejects.toThrow();

    const found = await db.query.users.findFirst({ where: eq(schema.users.email, GUEST.email) });
    expect(found).toBeUndefined();
  });
});
