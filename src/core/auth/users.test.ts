import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import type { Database } from "@/db/client";

import {
  accountsExist,
  changePassword,
  createInvite,
  listInvites,
  redeemInvite,
  registerFirstUser,
  signInWithGoogle,
  updateProfile,
} from "./users";
import { verifyPassword } from "@/server/auth/password";

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

describe("signInWithGoogle", () => {
  const GOOGLE = { googleId: "google-sub-1", email: "founder@example.com", displayName: "Founder" };

  it("makes the first Google sign-in the owner, same as password registration", async () => {
    const db = await testDb();
    const user = await signInWithGoogle(GOOGLE, undefined, db);

    expect(user.role).toBe("owner");
    expect(user.googleId).toBe(GOOGLE.googleId);
    expect(await accountsExist(db)).toBe(true);
  });

  it("returns the same row on a later sign-in by the same Google account", async () => {
    const db = await testDb();
    const first = await signInWithGoogle(GOOGLE, undefined, db);
    const second = await signInWithGoogle(GOOGLE, undefined, db);

    expect(second.id).toBe(first.id);
  });

  it("refuses a second identity with no invite and no matching account", async () => {
    const db = await testDb();
    await signInWithGoogle(GOOGLE, undefined, db);

    await expect(
      signInWithGoogle({ ...GOOGLE, googleId: "google-sub-2", email: "other@example.com" }, undefined, db),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("lets a code from the owner add a Google-identified member, same as redeemInvite", async () => {
    const db = await testDb();
    const owner = await signInWithGoogle(GOOGLE, undefined, db);
    const { code } = await createInvite(owner.id, db);

    const member = await signInWithGoogle(
      { googleId: "google-sub-2", email: "guest@example.com", displayName: "Guest" },
      code,
      db,
    );
    expect(member.role).toBe("member");
  });

  /**
   * The case the whole design turns on: someone who registered with a
   * password, later choosing "Sign in with Google" for the same address,
   * ends up back in the one account they already had rather than a second
   * one Grape cannot tell apart from it.
   */
  it("links a Google identity onto an existing password account with the same address, rather than creating a second one", async () => {
    const db = await testDb();
    const owner = await registerFirstUser(ACCOUNT, db);

    const linked = await signInWithGoogle(
      { googleId: "google-sub-1", email: ACCOUNT.email, displayName: "Owner" },
      undefined,
      db,
    );

    expect(linked.id).toBe(owner.id);
    expect(linked.googleId).toBe("google-sub-1");
    expect(await db.select().from(schema.users)).toHaveLength(1);

    // And the password that account was created with still works — linking
    // must not disturb it.
    const row = await db.query.users.findFirst({ where: eq(schema.users.id, owner.id) });
    expect(await verifyPassword(ACCOUNT.password, row!.passwordHash)).toBe(true);
  });

  it("gives a Google-only account a password hash nothing can ever verify against", async () => {
    const db = await testDb();
    const user = await signInWithGoogle(GOOGLE, undefined, db);

    expect(await verifyPassword("anything at all", user.passwordHash)).toBe(false);
  });
});

describe("updateProfile", () => {
  it("renames and re-addresses the account, normalising the address as registration does", async () => {
    const db = await testDb();
    const user = await registerFirstUser(ACCOUNT, db);

    const updated = await updateProfile(user.id, { displayName: " 新しい名前 ", email: "NEW@Example.COM" }, db);

    expect(updated.displayName).toBe("新しい名前");
    expect(updated.email).toBe("new@example.com");
  });

  it("refuses an address another account already holds", async () => {
    const db = await testDb();
    const owner = await registerFirstUser(ACCOUNT, db);
    const invite = await createInvite(owner.id, db);
    const member = await redeemInvite(
      invite.code,
      { email: "member@example.com", displayName: "Member", password: ACCOUNT.password },
      db,
    );

    await expect(
      updateProfile(member.id, { displayName: "Member", email: "owner@example.com" }, db),
    ).rejects.toThrow(/already registered/i);
  });

  it("leaves the password alone, which is the other form's job", async () => {
    const db = await testDb();
    const user = await registerFirstUser(ACCOUNT, db);

    await updateProfile(user.id, { displayName: "Owner", email: "moved@example.com" }, db);

    const row = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
    expect(await verifyPassword(ACCOUNT.password, row!.passwordHash)).toBe(true);
  });
});

describe("changePassword", () => {
  it("replaces the hash once the current password verifies", async () => {
    const db = await testDb();
    const user = await registerFirstUser(ACCOUNT, db);

    await changePassword(user.id, ACCOUNT.password, "an-even-longer-password", db);

    const row = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
    expect(await verifyPassword("an-even-longer-password", row!.passwordHash)).toBe(true);
    expect(await verifyPassword(ACCOUNT.password, row!.passwordHash)).toBe(false);
  });

  /** A borrowed session must not be enough to lock the owner out of their own instance. */
  it("refuses without the current password, which the session alone does not prove", async () => {
    const db = await testDb();
    const user = await registerFirstUser(ACCOUNT, db);

    await expect(
      changePassword(user.id, "not-the-password", "an-even-longer-password", db),
    ).rejects.toThrow(/current password/i);

    const row = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
    expect(await verifyPassword(ACCOUNT.password, row!.passwordHash)).toBe(true);
  });

  it("holds the new password to the same minimum registration does", async () => {
    const db = await testDb();
    const user = await registerFirstUser(ACCOUNT, db);

    await expect(changePassword(user.id, ACCOUNT.password, "short", db)).rejects.toThrow(
      /shorter than the minimum/i,
    );
  });
});

describe("listInvites", () => {
  it("reports state without ever handing the code back", async () => {
    const db = await testDb();
    const owner = await registerFirstUser(ACCOUNT, db);
    const open = await createInvite(owner.id, db);
    const spent = await createInvite(owner.id, db);
    await redeemInvite(
      spent.code,
      { email: "member@example.com", displayName: "Member", password: ACCOUNT.password },
      db,
    );

    const listed = await listInvites(db);

    expect(listed.map((invite) => invite.state).sort()).toEqual(["open", "used"]);
    expect(JSON.stringify(listed)).not.toContain(open.code);
  });

  it("calls an unused invite expired once its moment has passed, with no sweep to run", async () => {
    const db = await testDb();
    const owner = await registerFirstUser(ACCOUNT, db);
    await createInvite(owner.id, db);

    const wayLater = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    const [invite] = await listInvites(db, wayLater);

    expect(invite.state).toBe("expired");
  });
});
