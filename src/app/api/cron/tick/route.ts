import { NextResponse } from "next/server";

import { AppError } from "@/core/errors";
import { runLoopTick } from "@/core/loop/tick";
import { env } from "@/env";
import { cronAuthorized } from "@/server/cron-auth";
import { route } from "@/server/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs one turn of the weekly loop (core/loop/tick.ts) for every account.
 *
 * Meant for a scheduler — the Cloud Functions trigger in functions/index.js,
 * or anything else that can send a POST once a day. It has no session to present, so the proxy lets it
 * through (src/proxy.ts) and this checks `Authorization: Bearer
 * $GRAPE_CRON_SECRET` instead.
 *
 * 503 rather than 401 when no secret is configured: nothing the caller could
 * send would be right, and the fix is on the server. See server/cron-auth.ts
 * for the comparison.
 */
export const POST = route("cron.tick", async (request: Request) => {
  const secret = env.GRAPE_CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "GRAPE_CRON_SECRET is not set; the scheduled loop is disabled." },
      { status: 503 },
    );
  }

  if (!cronAuthorized(request.headers.get("authorization"), secret)) {
    throw new AppError("UNAUTHORIZED", "Bad or missing cron secret");
  }

  const result = await runLoopTick();
  return NextResponse.json(result);
});
