import { NextResponse } from "next/server";
import { z } from "zod";

import { runProductSetup, startProductSetup } from "@/core/product/register";
import { db } from "@/db/client";
import { requireUserId } from "@/server/auth/current-user";
import { currentRequestId, runInRequestScope } from "@/server/context";
import { describeError, log } from "@/server/log";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

const RegisterInputSchema = z.object({
  url: z.string().min(1, "url is required"),
  name: z.string().optional(),
});

export const GET = route("products.list", async () => {
  const products = await db.query.products.findMany({
    where: (products, { eq }) => eq(products.userId, requireUserId()),
    orderBy: (products, { desc }) => [desc(products.createdAt)],
  });
  return NextResponse.json({ products });
});

/**
 * Answers as soon as the row exists, then keeps reading the site after the
 * response has gone out.
 *
 * This used to hold the request open for the whole crawl — five fetches, a
 * possible headless render, and on the AI path a model call. That made
 * navigating away destructive: the browser cancelled the request, the reader
 * got nothing back, and what they found later was a product with no context
 * and no account of why. The work now belongs to the row rather than to the
 * request, so leaving the page costs nothing (see runProductSetup).
 *
 * 202, not 201: the product exists, and what was asked for is still happening.
 */
export const POST = route("products.create", async (request) => {
  const input = RegisterInputSchema.parse(await request.json().catch(() => null));
  const started = await startProductSetup({ ...input, userId: requireUserId() });

  // Deliberately not awaited — the point is to outlive this handler. Re-enters
  // the request scope by hand because the ambient one ends with the response,
  // and everything downstream (the log line, the per-account LLM spend record)
  // reads the account and request id from there.
  const scope = { requestId: currentRequestId() ?? crypto.randomUUID(), userId: requireUserId() };
  void runInRequestScope(scope, () =>
    runProductSetup(started).catch((error: unknown) =>
      // runProductSetup records its own failures on the row; reaching here
      // means it failed at recording one, which only the log can carry.
      log.error("product.setup_unrecorded", {
        productId: started.productId,
        ...describeError(error),
      }),
    ),
  );

  return NextResponse.json(started, { status: 202 });
});
