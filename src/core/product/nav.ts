import { db, type Database } from "@/db/client";
import { by } from "@/db/sort";

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

  const products = (await conn.products.find({ where: [["userId", "==", userId]] })).sort(
    by((product) => product.createdAt),
  );
  if (products.length === 0) return [];

  // One query across the account's products rather than one per product: the
  // sidebar renders on every navigation, so its cost is paid constantly.
  // Filtered to this account's products for the same reason — otherwise the
  // scan would grow with every other account's tasks. The status filter is
  // code, because Firestore allows only one `in` per query and it is spent on
  // productId.
  const tasks = await conn.tasks.find({
    where: [["productId", "in", products.map((product) => product.id)]],
  });
  const byProduct = new Map<string, number>();
  for (const task of tasks) {
    if (task.status === "done" || task.status === "skipped") continue;
    byProduct.set(task.productId, (byProduct.get(task.productId) ?? 0) + 1);
  }

  return products.map((product) => ({
    id: product.id,
    name: product.name,
    url: product.url,
    openTasks: byProduct.get(product.id) ?? 0,
  }));
}
