import { NextResponse } from "next/server";

import { AppError } from "@/core/errors";
import { findOwnedProduct } from "@/core/product/ownership";
import { db } from "@/db/client";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/**
 * Reads the product's site again, the same way registration did.
 *
 * The way out of two dead ends that used to have none: a first read that
 * failed left the product page saying "まだ内容がありません" with only a delete
 * button beside it, and changing a product's URL left a context describing the
 * old site.
 *
 * Same shape as POST /api/products: mark the row pending and answer at once.
 * The page then shows progress, and its progress component runs the crawl in
 * a request of its own (api/products/[id]/setup). A previous context is kept
 * until the new one lands, and kept for good if this attempt fails.
 */
export const POST = route(
  "products.reread",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const product = await findOwnedProduct(id, requireUserId());
    if (!product) throw new AppError("NOT_FOUND", `No product ${id} for this account`);

    await db.products.update(id, { setupStatus: "pending", setupError: null, setupClaimedAt: null });
    return NextResponse.json({ productId: id }, { status: 202 });
  },
);
