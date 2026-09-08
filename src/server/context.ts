import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Carries the current request's id to whatever ends up logging, without
 * putting an id parameter on `crawlSite`, `completeStructured`,
 * `diagnoseProduct` and roughly twenty other functions. Those signatures take
 * their dependencies explicitly so they can be unit tested with fakes, and
 * that property is worth more than avoiding one piece of ambient state.
 *
 * Node-only: middleware runs on the Edge runtime and cannot see this store,
 * which is why it mints the id into a header and the route wrapper — running
 * under `runtime = "nodejs"` — is what opens the scope.
 */
const store = new AsyncLocalStorage<{ requestId: string }>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return store.run({ requestId }, fn);
}

export function currentRequestId(): string | undefined {
  return store.getStore()?.requestId;
}
