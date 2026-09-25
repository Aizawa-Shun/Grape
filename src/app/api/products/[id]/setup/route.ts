import { NextResponse } from "next/server";

import { assertProductOwner } from "@/core/product/ownership";
import { claimProductSetup, runProductSetup } from "@/core/product/register";
import { db } from "@/db/client";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";
// A crawl with the browser fallback and a model call can take a minute or
// two; the request has to outlive it (see claimProductSetup for why the
// crawl runs inside a request at all).
export const maxDuration = 300;

/**
 * Runs the pending crawl for a product, in this request.
 *
 * Called by the progress screen (setup-progress.tsx) as soon as it sees a
 * pending product. If another request already holds the claim, this answers
 * at once and the screen keeps polling; otherwise it reads the site, writes
 * the context, and answers with the outcome. The row records success or
 * failure either way, so nothing depends on this response arriving.
 */
export const POST = route(
  "products.setup",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await assertProductOwner(id, requireUserId());

    const claim = await claimProductSetup(id);
    if (!claim) return NextResponse.json({ running: true }, { status: 202 });

    await runProductSetup(claim);
    const product = await db.products.get(id);
    return NextResponse.json({ running: false, setupStatus: product?.setupStatus ?? null });
  },
);
