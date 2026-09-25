import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryStore } from "@/db/store/memory";
import type { Store } from "@/db/store/types";

import {
  INVITE_TTL_MS,
  accountsExist,
  createInvite,
  enrollAccount,
  getLlmApiKey,
  hasLlmApiKeys,
  listInvites,
  setLlmApiKey,
  updateProfile,
} from "./users";

let db: Store;

beforeEach(() => {
  db = createMemoryStore();
});

const identity = (uid: string, email = `${uid}@example.com`, displayName: string | null = null) => ({
  uid,
  email,
  displayName,
});

describe("enrollAccount — the first account", () => {
  it("makes the first person to sign in the owner", async () => {
    const { user, created } = await enrollAccount(identity("u1", "Owner@Example.com", "Owner"), undefined, db);

    expect(created).toBe(true);
    expect(user).toMatchObject({ id: "u1", role: "owner", email: "owner@example.com", displayName: "Owner" });
    expect(await accountsExist(db)).toBe(true);
  });

  it("names an account after its address when Firebase has no display name for it", async () => {
    const { user } = await enrollAccount(identity("u1", "chess.fan@example.com"), undefined, db);
    expect(user.displayName).toBe("chess.fan");
  });

  /** Two people arriving at a fresh instance at once cannot both become the owner. */
  it("lets only one of two simultaneous first sign-ins become the owner", async () => {
    const results = await Promise.allSettled([
      enrollAccount(identity("u1"), undefined, db),
      enrollAccount(identity("u2"), undefined, db),
    ]);

    const owners = (await db.users.find()).filter((user) => user.role === "owner");
    expect(owners).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});

describe("enrollAccount — everyone after", () => {
  beforeEach(async () => {
    await enrollAccount(identity("owner"), undefined, db);
  });

  it("refuses a new account that brings no invite", async () => {
    await expect(enrollAccount(identity("stranger"), undefined, db)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(await db.users.get("stranger")).toBeNull();
  });

  it("lets a code from the owner in as a member, and spends it", async () => {
    const { code } = await createInvite("owner", db);

    const { user } = await enrollAccount(identity("member"), code, db);

    expect(user.role).toBe("member");
    const [invite] = await db.invites.find();
    expect(invite.usedBy).toBe("member");
  });

  it("accepts the code however it is typed back — spaces around it, lower case", async () => {
    const { code } = await createInvite("owner", db);

    await expect(enrollAccount(identity("member"), `  ${code.toLowerCase()} `, db)).resolves.toMatchObject({
      created: true,
    });
  });

  it("stores only a hash of the code, never the code", async () => {
    const { code } = await createInvite("owner", db);

    const [invite] = await db.invites.find();
    expect(JSON.stringify(invite)).not.toContain(code);
  });

  it("cannot be redeemed twice", async () => {
    const { code } = await createInvite("owner", db);
    await enrollAccount(identity("first"), code, db);

    await expect(enrollAccount(identity("second"), code, db)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await db.users.get("second")).toBeNull();
  });

  it("expires", async () => {
    const issued = new Date("2026-09-01T00:00:00Z");
    const { code } = await createInvite("owner", db, issued);

    await expect(
      enrollAccount(identity("late"), code, db, new Date(issued.getTime() + INVITE_TTL_MS + 1)),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("refuses a code that was never issued, with the same message as a used one", async () => {
    const unknown = await enrollAccount(identity("guess"), "NOT-A-REAL-CODE", db).catch((e: unknown) => e);
    const { code } = await createInvite("owner", db);
    await enrollAccount(identity("first"), code, db);
    const used = await enrollAccount(identity("second"), code, db).catch((e: unknown) => e);

    expect((unknown as { hint: string }).hint).toBe((used as { hint: string }).hint);
  });

  /** A returning member is recognised by uid alone; an invite is only ever for the first time. */
  it("lets a returning account straight back in, without a code, and records the visit", async () => {
    const later = new Date("2026-10-01T00:00:00Z");
    const { user, created } = await enrollAccount(identity("owner"), undefined, db, later);

    expect(created).toBe(false);
    expect(user.role).toBe("owner");
    expect((await db.users.get("owner"))?.lastLoginAt).toEqual(later);
  });
});

describe("updateProfile", () => {
  it("renames the account", async () => {
    await enrollAccount(identity("u1"), undefined, db);

    expect((await updateProfile("u1", { displayName: "  新しい名前 " }, db)).displayName).toBe("新しい名前");
  });

  it("refuses an empty name", async () => {
    await enrollAccount(identity("u1"), undefined, db);

    await expect(updateProfile("u1", { displayName: "   " }, db)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("listInvites", () => {
  it("reports state without ever handing the code back", async () => {
    await enrollAccount(identity("owner"), undefined, db);
    const { code } = await createInvite("owner", db);
    await createInvite("owner", db);
    await enrollAccount(identity("member"), code, db);

    const invites = await listInvites(db);
    expect(invites.map((invite) => invite.state).sort()).toEqual(["open", "used"]);
    expect(JSON.stringify(invites)).not.toContain(code);
  });

  it("calls an unused invite expired once its moment has passed, with no sweep to run", async () => {
    const issued = new Date("2026-09-01T00:00:00Z");
    await createInvite("owner", db, issued);

    const [invite] = await listInvites(db, new Date(issued.getTime() + INVITE_TTL_MS + 1));
    expect(invite.state).toBe("expired");
  });
});

describe("LLM API keys", () => {
  it("stores a key encrypted, and gives it back whole", async () => {
    await enrollAccount(identity("u1"), undefined, db);

    await setLlmApiKey("u1", "anthropic", "sk-ant-secret-value", db);

    expect(JSON.stringify(await db.users.get("u1"))).not.toContain("sk-ant-secret-value");
    expect(await getLlmApiKey("u1", "anthropic", db)).toBe("sk-ant-secret-value");
    expect(await hasLlmApiKeys("u1", db)).toEqual({ anthropic: true, "openai-compat": false });
  });

  it("clears a key with null", async () => {
    await enrollAccount(identity("u1"), undefined, db);
    await setLlmApiKey("u1", "openai-compat", "sk-x", db);

    await setLlmApiKey("u1", "openai-compat", null, db);

    expect(await getLlmApiKey("u1", "openai-compat", db)).toBeUndefined();
  });
});
