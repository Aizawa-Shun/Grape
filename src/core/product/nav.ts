import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

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

/**
 * `userId` is required rather than optional. This returns a list, so deciding
 * whose list it is belongs to the query — an optional filter here would be one
 * forgotten argument away from putting somebody else's services in the
 * sidebar.
 */
export async function loadNavProducts(userId: string, database?: Database): Promise<NavProduct[]> {
  const conn = database ?? db;

  const products = await conn.query.products.findMany({
    columns: { id: true, name: true, url: true },
    where: eq(schema.products.userId, userId),
    orderBy: (products, { asc }) => [asc(products.createdAt)],
  });
  if (products.length === 0) return [];

  // One grouped query rather than one per product: the sidebar renders on
  // every navigation, so its cost is paid constantly. Restricted to this
  // account's products for the same reason — otherwise the scan grows with
  // every other account's tasks, none of which can affect the answer.
  const counts = await conn
    .select({ productId: schema.tasks.productId, n: sql<number>`count(*)` })
    .from(schema.tasks)
    .where(
      and(
        inArray(
          schema.tasks.productId,
          products.map((product) => product.id),
        ),
        notInArray(schema.tasks.status, ["done", "skipped"]),
      ),
    )
    .groupBy(schema.tasks.productId);

  const byProduct = new Map(counts.map((row) => [row.productId, Number(row.n)]));

  return products.map((product) => ({
    ...product,
    openTasks: byProduct.get(product.id) ?? 0,
  }));
}
