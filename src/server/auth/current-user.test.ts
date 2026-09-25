import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Store } from "@/db/store/types";

/**
 * What a verified session turns into. The Firebase Admin SDK's own
 * verification is stood in for here — its job (signature, expiry,
 * revocation) is Firebase's to test — so this checks Grape's half: that a
 * session is only as good as the account document behind it, and that an
 * unverifiable cookie is a signed-out reader rather than an error.
 *
 * The end-to-end half, with real session cookies minted by the Auth
 * emulator, is e2e/auth.e2e.ts.
 */
let db: Store;
vi.mock("@/db/client", () => ({
  get db() {
    return db;
  },
}));

const verified = vi.fn<(cookie: string) => Promise<{ uid: string }>>();
vi.mock("@/db/firebase", () => ({
  firebaseAuth: () => ({ verifySessionCookie: (cookie: string) => verified(cookie) }),
}));

const cookieStore = { value: undefined as string | undefined };
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieStore.value ? { value: cookieStore.value } : undefined) }),
}));

/** Stands in for the framework's redirect, which throws to unwind the render. */
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

beforeEach(async () => {
  const { createMemoryStore } = await import("@/db/store/memory");
  db = createMemoryStore();
  cookieStore.value = undefined;
  verified.mockReset();
});

describe("requireUser", () => {
  it("loads the account a verified session belongs to", async () => {
    await db.users.set("uid-owner", { email: "owner@example.com", displayName: "Owner", role: "owner" });
    cookieStore.value = "session-cookie";
    verified.mockResolvedValue({ uid: "uid-owner" });

    const { requireUser } = await import("./current-user");
    expect((await requireUser()).email).toBe("owner@example.com");
    expect(verified).toHaveBeenCalledWith("session-cookie");
  });

  /** An account removed from Grape, or never let in: a signed-out reader, not a 500. */
  it("sends a valid session with no Grape account behind it to /login", async () => {
    cookieStore.value = "session-cookie";
    verified.mockResolvedValue({ uid: "uid-nobody" });

    const { requireUser } = await import("./current-user");
    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });

  it("treats a cookie that does not verify as no session at all", async () => {
    cookieStore.value = "forged";
    verified.mockRejectedValue(new Error("auth/session-cookie-revoked"));

    const { currentUser } = await import("./current-user");
    expect(await currentUser()).toBeNull();
  });
});

describe("requireApiUser", () => {
  /**
   * A route handler answers a fetch. A 307 to an HTML sign-in page is not
   * something the caller can do anything with, so this one throws and gets
   * its 401.
   */
  it("throws rather than redirecting a fetch", async () => {
    const { requireApiUser } = await import("./current-user");
    await expect(requireApiUser()).rejects.toThrow(/No session on a route that requires one/);
  });
});

describe("sessionUserIdFor", () => {
  it("reads the __session cookie off the request it is handed", async () => {
    verified.mockResolvedValue({ uid: "uid-owner" });
    const { sessionUserIdFor } = await import("./current-user");

    const request = new Request("https://grape.example.com/api/products", {
      headers: { cookie: "other=1; __session=abc%2Fdef" },
    });
    expect(await sessionUserIdFor(request)).toBe("uid-owner");
    expect(verified).toHaveBeenCalledWith("abc/def");
  });

  it("answers undefined without asking Firebase when there is no cookie", async () => {
    const { sessionUserIdFor } = await import("./current-user");

    expect(await sessionUserIdFor(new Request("https://grape.example.com/"))).toBeUndefined();
    expect(verified).not.toHaveBeenCalled();
  });
});
