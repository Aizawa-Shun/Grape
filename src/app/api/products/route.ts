import { NextResponse } from "next/server";
import { z } from "zod";

import { registerProduct } from "@/core/product/register";
import { db, schema } from "@/db/client";

export const runtime = "nodejs";

const RegisterInputSchema = z.object({
  url: z.string().min(1, "url is required"),
  name: z.string().optional(),
});

export async function GET() {
  const products = await db.query.products.findMany({
    orderBy: (products, { desc }) => [desc(products.createdAt)],
  });
  return NextResponse.json({ products });
}

/**
 * Synchronous on purpose for the MVP: crawling ~5 pages plus one extraction
 * call takes a few seconds on the Anthropic path (much longer on a local
 * model), which is well inside a browser fetch timeout. Move this to a
 * background job only once that stops being true.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RegisterInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const result = await registerProduct(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
