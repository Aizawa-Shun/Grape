import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

/**
 * The disagreement the Edge cannot see.
 *
 * proxy.ts verifies the session cookie's signature and deliberately reads no
 * database, because it runs on every request including the ingest hot path. So
 * a cookie naming an account that no longer exists is, to the proxy, a valid
 * session — and the page behind it used to throw, answering 500 twice per
 * request with no way out from the browser, since a reload sends the same
 * cookie again.
 *
 * A real migrated database rather than a mock: what is under test is what
 * happens when a row is *absent*, which a stubbed query would only assert
 * about itself.
 */
const db = drizzle(createClient({ url: ":memory:" }), { schema });

vi.mock("@/db/client", () => ({
  get db() {
    return db;
  },
  schema,
}));

const SECRET = "test-signing-secret";
const cookieStore = { value: undefined as string | undefined };

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "grape.example.com" }),
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
  vi.stubEnv("GRAPE_SESSION_SECRET", SECRET);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.delete(schema.users);
  cookieStore.value = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function signInAs(userId: string) {
  const { issueSession } = await import("@/server/session");
  cookieStore.value = await issueSession(SECRET, userId);
}

describe("requireUser", () => {
  it("loads the account a valid session names", async () => {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: "owner@example.com",
        displayName: "Owner",
        passwordHash: "x",
        role: "owner",
      })
      .returning();
    await signInAs(user.id);

    const { requireUser } = await import("./current-user");
    expect((await requireUser()).email).toBe("owner@example.com");
  });

  it("sends a session naming a missing account to /login instead of failing the render", async () => {
    await signInAs("11111111-2222-3333-4444-555555555555");

    const { requireUser } = await import("./current-user");
    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });
});

describe("requireApiUser", () => {
  /**
   * A route handler answers a fetch. A 307 to an HTML sign-in page is not
   * something the caller can do anything with, so this one still throws and
   * gets its 401.
   */
  it("throws for the same session rather than redirecting a fetch", async () => {
    await signInAs("11111111-2222-3333-4444-555555555555");

    const { requireApiUser } = await import("./current-user");
    await expect(requireApiUser()).rejects.toThrow(/No session on a route that requires one/);
  });
});
