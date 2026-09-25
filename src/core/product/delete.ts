import { AppError } from "@/core/errors";
import { db, type Database } from "@/db/client";

/**
 * Removes a product and everything reasoned from it.
 *
 * The cascade the relational schema used to declare, written out: contexts,
 * crawled pages, events and diagnoses by `productId`; tasks by `productId`,
 * and each task's artifacts, action runs and outcomes by `taskId`. LLM calls
 * are the one exception, as they always were — a past call keeps its cost on
 * the books, with its `productId` cleared, because the spend happened
 * whether or not the product still exists.
 *
 * Not a transaction: a product's events can outnumber Firestore's 500-write
 * transaction limit many times over. The product document goes first, so a
 * deletion interrupted halfway leaves orphans nothing can reach rather than a
 * product that half-exists; the ownership check sees it gone immediately.
 */
export async function deleteProduct(
  productId: string,
  userId: string,
  database: Database = db,
): Promise<void> {
  const product = await database.products.get(productId);
  if (!product || product.userId !== userId) {
    throw new AppError("NOT_FOUND", `No product ${productId} for this account`);
  }

  const tasks = await database.tasks.find({ where: [["productId", "==", productId]] });
  await database.products.delete(productId);

  const byProduct = [["productId", "==", productId]] as const;
  await Promise.all([
    database.productContexts.deleteWhere(byProduct),
    database.crawlPages.deleteWhere(byProduct),
    database.events.deleteWhere(byProduct),
    database.diagnoses.deleteWhere(byProduct),
  ]);

  const taskIds = tasks.map((task) => task.id);
  if (taskIds.length > 0) {
    const byTask = [["taskId", "in", taskIds]] as const;
    await Promise.all([
      database.artifacts.deleteWhere(byTask),
      database.actionRuns.deleteWhere(byTask),
      database.outcomes.deleteWhere(byTask),
    ]);
  }
  await database.tasks.deleteWhere(byProduct);

  const calls = await database.llmCalls.find({ where: byProduct });
  await Promise.all(calls.map((call) => database.llmCalls.update(call.id, { productId: null })));
}
