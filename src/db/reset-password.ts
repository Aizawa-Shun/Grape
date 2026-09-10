import "dotenv/config";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";

import { hashPassword } from "@/server/auth/password";
import { databaseCredentials } from "./connection";
import { applyPragmas } from "./pragmas";
import * as schema from "./schema";

/**
 * Sets an account's password from the server's shell.
 *
 * This exists because Grape has no e-mail sender, which makes "forgot my
 * password" unanswerable over the web: a member can be re-invited by the
 * owner, but the owner has nobody above them. Without this, one forgotten
 * password would strand an instance and everything in it.
 *
 * Deliberately not reachable from the browser under any flag. It is
 * authenticated by the fact that you already have the machine.
 *
 *   pnpm db:reset-password someone@example.com 'the new password'
 */
async function main(): Promise<void> {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error("Usage: pnpm db:reset-password <email> <new password>");
    process.exit(2);
  }

  const client = createClient(databaseCredentials());
  try {
    await applyPragmas(client);
    const db = drizzle(client, { schema });

    const updated = await db
      .update(schema.users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(schema.users.email, email.trim().toLowerCase()))
      .returning({ email: schema.users.email });

    if (updated.length === 0) {
      console.error(`No account with that address: ${email}`);
      process.exit(1);
    }
    console.log(`Password set for ${updated[0].email}. Existing sessions stay valid.`);
  } finally {
    client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
