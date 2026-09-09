import { NextResponse } from "next/server";
import { z } from "zod";

import { registerProduct } from "@/core/product/register";
import { db, schema } from "@/db/client";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

const RegisterInputSchema = z.object({
  url: z.string().min(1, "url is required"),
  name: z.string().optional(),
});

export const GET = route("products.list", async () => {
  const products = await db.query.products.findMany({
    orderBy: (products, { desc }) => [desc(products.createdAt)],
  });
  return NextResponse.json({ products });
});

/**
 * Synchronous on purpose for the MVP: crawling ~5 pages plus one extraction
 * call takes a few seconds on the Anthropic path (much longer on a local
 * model), which is well inside a browser fetch timeout. Move this to a
 * background job only once that stops being true.
 */
export const POST = route("products.create", async (request) => {
  const input = RegisterInputSchema.parse(await request.json().catch(() => null));
  // Accounts do not exist yet, so LOCAL_USER is not a placeholder — it is who
  // owns this product until the first person registers and adopts it.
  const result = await registerProduct({ ...input, userId: schema.LOCAL_USER });
  return NextResponse.json(result, { status: 201 });
});
