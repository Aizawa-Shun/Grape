import { AppError } from "@/core/errors";
import { db, type Database } from "@/db/client";
import type { Product, Task } from "@/db/schema";

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

export type { Product, Task };

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
  // Fetched by id, then compared — one document read, and a wrong owner reads
  // exactly like a missing document to the caller.
  const product = await database.products.get(productId);
  return product && product.userId === userId ? product : null;
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
 * collection takes, which is why only `products` carries `userId`.
 */
export async function assertTaskOwner(
  taskId: string,
  userId: string,
  database: Database = db,
): Promise<{ task: Task; product: Product }> {
  const task = await database.tasks.get(taskId);
  const product = task ? await findOwnedProduct(task.productId, userId, database) : null;
  if (!task || !product) throw new AppError("NOT_FOUND", `No task ${taskId} for this account`);
  return { task, product };
}
