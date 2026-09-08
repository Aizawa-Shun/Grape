import { notInArray, sql } from "drizzle-orm";

import { db, schema, type Database } from "@/db/client";

/**
 * What the sidebar needs, and nothing else.
 *
 * Deliberately not `loadSnapshots()` from next-step.ts: that one reads an
 * artifact and an outcome row per task to decide what to do next, which is the
 * right cost for the home page and the wrong cost for something rendered on
 * every single navigation.
 */
export interface NavProduct {
  id: string;
  name: string;
  url: string;
  /** Shown as a count beside 診断とタスク — the only "waiting on you" signal in the nav. */
  openTasks: number;
}

export async function loadNavProducts(database?: Database): Promise<NavProduct[]> {
  const conn = database ?? db;

  const products = await conn.query.products.findMany({
    columns: { id: true, name: true, url: true },
    orderBy: (products, { asc }) => [asc(products.createdAt)],
  });
  if (products.length === 0) return [];

  // One grouped query rather than one per product: the sidebar renders on
  // every navigation, so its cost is paid constantly.
  const counts = await conn
    .select({ productId: schema.tasks.productId, n: sql<number>`count(*)` })
    .from(schema.tasks)
    .where(notInArray(schema.tasks.status, ["done", "skipped"]))
    .groupBy(schema.tasks.productId);

  const byProduct = new Map(counts.map((row) => [row.productId, Number(row.n)]));

  return products.map((product) => ({
    ...product,
    openTasks: byProduct.get(product.id) ?? 0,
  }));
}
