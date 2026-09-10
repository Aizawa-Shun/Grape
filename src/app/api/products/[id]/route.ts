import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError } from "@/core/errors";
import { db, schema } from "@/db/client";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/**
 * Setting the key event is what turns on the Activate (and, transitively,
 * Retain) stage of the funnel — see core/data/funnel.ts. Nothing else on the
 * product needs editing through this route yet, so it only accepts this one
 * field rather than doubling as a general product-update endpoint.
 */
const PatchInputSchema = z.object({
  keyEventName: z.string().trim().min(1).max(200).nullable(),
});

export const PATCH = route(
  "products.patch",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const input = PatchInputSchema.parse(await request.json().catch(() => null));

    // The ownership check is the WHERE clause rather than a lookup before it:
    // one statement, so there is no gap between deciding and writing.
    const [updated] = await db
      .update(schema.products)
      .set({ keyEventName: input.keyEventName })
      .where(and(eq(schema.products.id, id), eq(schema.products.userId, requireUserId())))
      .returning();

    if (!updated) throw new AppError("NOT_FOUND", `No product ${id} for this account`);

    return NextResponse.json({ product: updated });
  },
);

/**
 * Removes a product and everything reasoned from it — crawl pages, contexts,
 * diagnoses, tasks — via the cascades declared in schema.ts. `llm_calls` is the
 * one exception (ON DELETE SET NULL): a past call keeping its cost on the
 * books after the product it was for is gone is the point, not a bug.
 *
 * The only way to clear a product Grape could never read: registration used
 * to leave a row with no context behind on a crawl or extraction failure, with
 * nothing in the UI able to remove it (see core/product/register.ts).
 */
export const DELETE = route(
  "products.delete",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const [deleted] = await db
      .delete(schema.products)
      .where(and(eq(schema.products.id, id), eq(schema.products.userId, requireUserId())))
      .returning({ id: schema.products.id });

    if (!deleted) throw new AppError("NOT_FOUND", `No product ${id} for this account`);

    return new NextResponse(null, { status: 204 });
  },
);
