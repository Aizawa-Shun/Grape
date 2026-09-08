import { describe, expect, it } from "vitest";

import { describeMigrationStatus, migrationStatus } from "./migration-status";

const journal = [
  { when: 1000, tag: "0000_first" },
  { when: 2000, tag: "0001_second" },
  { when: 3000, tag: "0002_third" },
];

function client(rows: Array<Record<string, unknown>> | Error) {
  return {
    async execute() {
      if (rows instanceof Error) throw rows;
      return { rows } as never;
    },
  };
}

describe("migrationStatus", () => {
  it("passes when the applied set matches what this checkout ships", async () => {
    const status = await migrationStatus(client([{ n: 3, last: 3000 }]), journal);

    expect(status).toEqual({ ok: true, applied: 3 });
  });

  it("fails a database that is behind — the case a table count silently passed", async () => {
    const status = await migrationStatus(client([{ n: 1, last: 1000 }]), journal);

    expect(status).toMatchObject({ ok: false, reason: "behind", applied: 1, expected: 3 });
    expect(describeMigrationStatus(status)).toContain("pnpm db:migrate");
  });

  it("reports a database ahead of the code as needing a pull, not a migrate", async () => {
    const status = await migrationStatus(client([{ n: 4, last: 4000 }]), journal);

    expect(status).toMatchObject({ reason: "ahead" });
    expect(describeMigrationStatus(status)).toContain("pull");
  });

  it("catches a rewritten history, where the count matches but the migrations differ", async () => {
    const status = await migrationStatus(client([{ n: 3, last: 2999 }]), journal);

    expect(status).toMatchObject({ reason: "diverged" });
    expect(describeMigrationStatus(status)).not.toContain("pnpm db:migrate");
  });

  it("treats a missing migrations table as never migrated rather than as an error", async () => {
    const status = await migrationStatus(
      client(new Error("no such table: __drizzle_migrations")),
      journal,
    );

    expect(status).toMatchObject({ reason: "never_migrated", applied: 0 });
  });

  it("treats an empty migrations table the same way", async () => {
    const status = await migrationStatus(client([{ n: 0, last: null }]), journal);

    expect(status).toMatchObject({ reason: "never_migrated" });
  });
});
