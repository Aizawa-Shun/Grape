import { NextResponse } from "next/server";

import { getProvider } from "@/core/llm";
import { sqlClient } from "@/db/client";
import { env } from "@/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * M0 acceptance check: can Grape reach its database and its model?
 *
 * `?llm=0` skips the model call — useful when you only want to know the process
 * is up without spending a token.
 */
export async function GET(request: Request) {
  const wantsLlm = new URL(request.url).searchParams.get("llm") !== "0";

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

async function checkDatabase(): Promise<{ ok: boolean; url: string; detail: string }> {
  try {
    const result = await sqlClient.execute(
      "select count(*) as n from sqlite_master where type = 'table'",
    );
    const tables = Number(result.rows[0]?.n ?? 0);
    return {
      ok: tables > 0,
      url: env.DATABASE_URL,
      detail:
        tables > 0
          ? `${tables} tables`
          : "no tables — run `pnpm db:generate && pnpm db:migrate`",
    };
  } catch (error) {
    return {
      ok: false,
      url: env.DATABASE_URL,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
