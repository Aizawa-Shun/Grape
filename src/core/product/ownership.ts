import { and, eq } from "drizzle-orm";

import { AppError } from "@/core/errors";
import { db, schema, type Database } from "@/db/client";

/**
 * The one place that answers "may this person see this row".
 *
 * Both of these throw NOT_FOUND rather than a dedicated forbidden code, and
 * that is the point: a 403 confirms the id exists. Someone holding a product
 * id they should not have would learn from a 403 that it is real, which is
 * exactly the fact worth withholding. An unknown id and someone else's id are
 * indistinguishable from outside, because to this account they are the same
 * thing — a product that is not theirs.
 *
 * Applied at the routes and pages rather than inside `diagnoseProduct`,
 * `getFunnelForRange`, `generateArtifact` and the rest. Those take an id and
 * their dependencies explicitly so they can be unit tested without a session;
 * pushing authorization into them would trade that for a guarantee the
 * callers can give just as well, in one line, where the session already is.
 */

export type Product = typeof schema.products.$inferSelect;
export type Task = typeof schema.tasks.$inferSelect;

/**
 * The lookup itself. Pages want this, because their way of saying "no such
 * thing" is `notFound()` rather than a thrown error; routes want the assert
 * below. Both ask the same question, so neither can be tightened without the
 * other.
 */
export async function findOwnedProduct(
  productId: string,
  userId: string,
  database: Database = db,
): Promise<Product | null> {
  const product = await database.query.products.findFirst({
    where: and(eq(schema.products.id, productId), eq(schema.products.userId, userId)),
  });
  return product ?? null;
}

export async function assertProductOwner(
  productId: string,
  userId: string,
  database: Database = db,
): Promise<Product> {
  const product = await findOwnedProduct(productId, userId, database);
  if (!product) throw new AppError("NOT_FOUND", `No product ${productId} for this account`);
  return product;
}

/**
 * Tasks reach their owner through their product — the same route every other
 * table in the schema takes, which is why only `products` carries `user_id`.
 */
export async function assertTaskOwner(
  taskId: string,
  userId: string,
  database: Database = db,
): Promise<{ task: Task; product: Product }> {
  const rows = await database
    .select({ task: schema.tasks, product: schema.products })
    .from(schema.tasks)
    .innerJoin(schema.products, eq(schema.tasks.productId, schema.products.id))
    .where(and(eq(schema.tasks.id, taskId), eq(schema.products.userId, userId)))
    .limit(1);

  const found = rows[0];
  if (!found) throw new AppError("NOT_FOUND", `No task ${taskId} for this account`);
  return found;
}
