import { createFirestoreStore } from "./store/firestore";
import type { Store } from "./store/types";

export type { Store } from "./store/types";
export type Database = Store;

/**
 * This module is server-only — see db/firebase.ts. Failing here names the
 * actual mistake instead of a Firebase Admin error deep inside a chunk.
 */
if (typeof window !== "undefined") {
  throw new Error(
    "@/db/client was imported into the browser bundle. Move the value a client component needs into a module that does not reach the database.",
  );
}

let store: Store | null = null;

async function load(): Promise<Store> {
  if (!store) {
    const { firestore } = await import("./firebase");
    store = createFirestoreStore(firestore());
  }
  return store;
}

/**
 * The Store every module defaults to, backed by Firestore.
 *
 * Lazy: nothing touches Firebase until the first call. That keeps importing a
 * core module free — a unit test that passes its own in-memory store never
 * initializes the Admin SDK, and neither does `next build` collecting pages.
 * Each method resolves the real store on first use and forwards to it.
 */
function lazyCollection(name: string) {
  return new Proxy(
    {},
    {
      get(_target, method: string) {
        return async (...args: unknown[]) => {
          const real = (await load()) as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>;
          return real[name][method](...args);
        };
      },
    },
  );
}

export const db: Store = new Proxy({} as Store, {
  get(_target, key: string) {
    if (key === "runTransaction") {
      return async (fn: Parameters<Store["runTransaction"]>[0]) => (await load()).runTransaction(fn);
    }
    if (key === "then") return undefined; // not a thenable
    return lazyCollection(key);
  },
});
