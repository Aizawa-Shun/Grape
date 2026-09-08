import { NextResponse } from "next/server";

import { getProvider } from "@/core/llm";
import { dbReady, sqlClient } from "@/db/client";
import { describeMigrationStatus, migrationStatus, readJournal } from "@/db/migration-status";
import { env } from "@/env";
import { readSession, sessionSecret } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * M0 acceptance check: can Grape reach its database and its model?
 *
 * `?llm=0` skips the model call — useful when you only want to know the process
 * is up without spending a token.
 */
export async function GET(request: Request) {
  // Public so that an uptime check needs no credentials — but a public
  // endpoint should not hand a stranger the ingest URL, the provider and the
  // model name, nor let them spend a token by asking for the LLM probe.
  const secret = await sessionSecret(env.GRAPE_SESSION_SECRET, env.GRAPE_ADMIN_PASSWORD);
  const session = secret
    ? await readSession(request.headers.get("cookie")?.match(/grape_session=([^;]+)/)?.[1], secret)
    : { valid: true, shouldRenew: false };

  if (!session.valid) {
    await dbReady;
    const { ok } = await checkDatabase();
    return NextResponse.json({ ok }, { status: ok ? 200 : 503 });
  }

  const wantsLlm = new URL(request.url).searchParams.get("llm") !== "0";

  await dbReady;
  const database = await checkDatabase();
  const llm = wantsLlm
    ? await getProvider().health()
    : { ok: true, provider: env.LLM_PROVIDER, model: "(skipped)", detail: "skipped via ?llm=0" };

  const ok = database.ok && llm.ok;

  return NextResponse.json(
    {
      ok,
      database,
      llm,
      config: {
        provider: env.LLM_PROVIDER,
        ingestBaseUrl: env.INGEST_BASE_URL,
        actionDryRun: env.GRAPE_ACTION_DRY_RUN,
        coldStartMinSessions: env.COLD_START_MIN_SESSIONS,
      },
    },
    { status: ok ? 200 : 503 },
  );
}

/**
 * Counting tables was not a real check: a database three migrations behind has
 * plenty of tables and passes, then fails later as a confusing query error.
 * Comparing what has been applied against what this checkout ships catches it
 * at the point where the answer is still "run the migration".
 */
async function checkDatabase(): Promise<{
  ok: boolean;
  url: string;
  detail: string;
  foreignKeys?: boolean;
}> {
  try {
    const status = await migrationStatus(sqlClient, await readJournal());
    const fk = await sqlClient.execute("PRAGMA foreign_keys");
    const foreignKeys = Number(Object.values(fk.rows[0] ?? {})[0] ?? 0) === 1;

    return {
      ok: status.ok && foreignKeys,
      url: env.DATABASE_URL,
      detail: foreignKeys
        ? describeMigrationStatus(status)
        : "foreign key enforcement is off — unknown products would be accepted by /api/collect",
      foreignKeys,
    };
  } catch (error) {
    return {
      ok: false,
      url: env.DATABASE_URL,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
