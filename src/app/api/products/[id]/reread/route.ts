import { NextResponse } from "next/server";

import { AppError } from "@/core/errors";
import { runProductSetup } from "@/core/product/register";
import { findOwnedProduct } from "@/core/product/ownership";
import { db } from "@/db/client";
import { requireUserId } from "@/server/auth/current-user";
import { currentRequestId, runInRequestScope } from "@/server/context";
import { describeError, log } from "@/server/log";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/**
 * Reads the product's site again, the same way registration did.
 *
 * The way out of two dead ends that used to have none: a first read that
 * failed left the product page saying "まだ内容がありません" with only a delete
 * button beside it, and changing a product's URL left a context describing the
 * old site. Re-registering the same URL from the home page did work, but only
 * by knowing to do it.
 *
 * Same shape as POST /api/products: mark the row pending and answer at once,
 * then keep reading after the response has gone — so the page can show
 * progress, and closing it costs nothing (see runProductSetup). A previous
 * context is kept until the new one lands, and kept for good if this attempt
 * fails.
 */
export const POST = route(
  "products.reread",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const userId = requireUserId();

    const product = await findOwnedProduct(id, userId);
    if (!product) throw new AppError("NOT_FOUND", `No product ${id} for this account`);
    await db.products.update(id, { setupStatus: "pending", setupError: null });

    // Re-entered by hand for the same reason as products/route.ts: the
    // ambient scope ends with this response, and the LLM spend record and
    // per-account API key lookup downstream both read the account from it.
    const scope = { requestId: currentRequestId() ?? crypto.randomUUID(), userId };
    void runInRequestScope(scope, () =>
      runProductSetup({ productId: product.id, url: product.url }).catch((error: unknown) =>
        log.error("product.reread_unrecorded", { productId: product.id, ...describeError(error) }),
      ),
    );

    return NextResponse.json({ productId: product.id }, { status: 202 });
  },
);
