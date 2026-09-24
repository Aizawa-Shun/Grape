import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError } from "@/core/errors";
import { updateProduct } from "@/core/product/update";
import { db, schema } from "@/db/client";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/** See core/product/update.ts for what each field does and why URL changes do not re-read. */
const PatchInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  url: z.string().trim().min(1).max(2000).optional(),
  keyEventName: z.string().trim().min(1).max(200).nullable().optional(),
});

export const PATCH = route(
  "products.patch",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const input = PatchInputSchema.parse(await request.json().catch(() => null));
    const product = await updateProduct(id, requireUserId(), input);
    return NextResponse.json({ product });
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
