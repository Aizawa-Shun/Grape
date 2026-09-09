import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { describe, expect, it } from "vitest";

import type { Database } from "@/db/client";
import * as schema from "@/db/schema";

import { loadNavProducts } from "./nav";

async function testDb(): Promise<Database> {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db as unknown as Database;
}

async function seed(db: Database) {
  await db.insert(schema.users).values([
    { id: "alice", email: "a@example.com", displayName: "A", passwordHash: "x", role: "owner" },
    { id: "bob", email: "b@example.com", displayName: "B", passwordHash: "x", role: "member" },
  ]);
  await db.insert(schema.products).values([
    { id: "a1", userId: "alice", url: "https://a.example.com", name: "Alice's" },
    { id: "b1", userId: "bob", url: "https://b.example.com", name: "Bob's" },
  ]);
  await db.insert(schema.tasks).values([
    {
      id: "b-task",
      productId: "b1",
      title: "Bob's open task",
      rationale: "because",
      stage: "reach",
      expectedMetric: "sessions",
      impact: 3,
      effort: 1,
      dueWeek: "2026-W37",
    },
  ]);
}

describe("loadNavProducts", () => {
  /**
   * The sidebar renders on every navigation, so if the filter were ever
   * dropped this is where someone else's service would appear — named, linked
   * and one click from a page that would then have to refuse them.
   */
  it("shows only the account's own services", async () => {
    const db = await testDb();
    await seed(db);

    expect((await loadNavProducts("alice", db)).map((p) => p.name)).toEqual(["Alice's"]);
    expect((await loadNavProducts("bob", db)).map((p) => p.name)).toEqual(["Bob's"]);
  });

  it("counts only the open tasks of the services it returns", async () => {
    const db = await testDb();
    await seed(db);

    expect(await loadNavProducts("alice", db)).toEqual([
      expect.objectContaining({ id: "a1", openTasks: 0 }),
    ]);
    expect(await loadNavProducts("bob", db)).toEqual([
      expect.objectContaining({ id: "b1", openTasks: 1 }),
    ]);
  });

  it("is empty for an account with nothing registered", async () => {
    const db = await testDb();
    await seed(db);

    expect(await loadNavProducts("nobody", db)).toEqual([]);
  });
});
