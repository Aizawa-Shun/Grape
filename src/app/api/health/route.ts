import { NextResponse } from "next/server";

import { AppError } from "@/core/errors";
import { getProvider, llmAvailable, type ProviderHealth } from "@/core/llm";
import { db } from "@/db/client";
import { loadSettings } from "@/core/settings";
import { currentUser } from "@/server/auth/current-user";

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
  // Asked through the same resolver the rest of the app uses rather than
  // re-reading the cookie here: two implementations of "who is this" is one
  // more than can be kept in agreement.
  if (!(await currentUser())) {
    const { ok } = await checkDatabase();
    return NextResponse.json({ ok }, { status: ok ? 200 : 503 });
  }

  const wantsLlm = new URL(request.url).searchParams.get("llm") !== "0";

  // The effective configuration, which is what someone debugging needs to see
  // — not what .env happens to say underneath an override.
  const settings = await loadSettings();
  const database = await checkDatabase();
  // AI being off is the configured, opt-in default (see env.ts) — not a
  // failure this check should report as one, so this does not even attempt
  // getProvider(), which would throw LLM_NOT_CONFIGURED.
  const llm = !wantsLlm
    ? { ok: true, provider: settings.LLM_PROVIDER, model: "(skipped)", detail: "skipped via ?llm=0" }
    : !llmAvailable()
      ? { ok: true, provider: "(none)", model: "(none)", detail: "AI is not configured (opt-in)" }
      : await checkLlm();

  const ok = database.ok && llm.ok;

  return NextResponse.json(
    {
      ok,
      database,
      llm,
      config: {
        provider: settings.LLM_PROVIDER,
        ingestBaseUrl: settings.INGEST_BASE_URL,
        actionDryRun: settings.GRAPE_ACTION_DRY_RUN,
        coldStartMinSessions: settings.COLD_START_MIN_SESSIONS,
      },
    },
    { status: ok ? 200 : 503 },
  );
}

/**
 * `getProvider()` can now fail for a reason this endpoint should not report
 * as broken: the instance has AI selected, but the signed-in account making
 * this request has not added their own API key yet (see core/llm/index.ts).
 * That is a fact about this account, not about whether the model is
 * reachable, so it is reported the same way "AI is not configured" above is —
 * `ok: true`, with a detail explaining why nothing was actually called.
 */
async function checkLlm(): Promise<ProviderHealth> {
  try {
    return await (await getProvider()).health();
  } catch (error) {
    if (error instanceof AppError && error.code === "LLM_NOT_CONFIGURED") {
      return { ok: true, provider: "(unavailable)", model: "(none)", detail: error.message };
    }
    throw error;
  }
}

/**
 * Can this server read Firestore with its own credentials? One document read
 * — the settings collection, which every request reads anyway — so an
 * uptime monitor calling this every minute costs next to nothing, and the
 * failure it catches (a service account without Firestore access, a wrong
 * project, the emulator not running) is the one that would otherwise surface
 * as every page failing at once.
 */
async function checkDatabase(): Promise<{ ok: boolean; project: string | null; detail: string }> {
  const project =
    process.env.FIREBASE_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    (process.env.FIREBASE_CONFIG ? (JSON.parse(process.env.FIREBASE_CONFIG).projectId ?? null) : null);
  try {
    await db.settings.find({ limit: 1 });
    return {
      ok: true,
      project,
      detail: process.env.FIRESTORE_EMULATOR_HOST
        ? `Firestore emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`
        : "Firestore reachable",
    };
  } catch (error) {
    return { ok: false, project, detail: error instanceof Error ? error.message : String(error) };
  }
}
