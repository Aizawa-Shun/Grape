import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteProduct } from "@/core/product/delete";
import { updateProduct } from "@/core/product/update";
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
 * Removes a product and everything reasoned from it — see
 * core/product/delete.ts for what that covers and why LLM calls stay.
 *
 * The only way to clear a product Grape could never read: registration used
 * to leave a row with no context behind on a crawl or extraction failure, with
 * nothing in the UI able to remove it (see core/product/register.ts).
 */
export const DELETE = route(
  "products.delete",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    await deleteProduct(id, requireUserId());
    return new NextResponse(null, { status: 204 });
  },
);
