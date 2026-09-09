import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Carries the ambient facts about the current request — its id, and who is
 * making it — to whatever ends up logging or recording spend, without putting
 * two more parameters on `crawlSite`, `completeStructured`, `diagnoseProduct`
 * and roughly twenty other functions. Those signatures take their dependencies
 * explicitly so they can be unit tested with fakes, and that property is worth
 * more than avoiding one piece of ambient state.
 *
 * The account is here for the same reason the request id is: `getProvider()`
 * hands out a cached provider to pure core functions that have no idea who
 * asked, and billing a model call to the right person cannot wait for a
 * parameter to be threaded through all of them.
 *
 * Node-only: proxy.ts runs on the Edge runtime and cannot see this store,
 * which is why it mints the id into a header and the route wrapper — running
 * under `runtime = "nodejs"` — is what opens the scope.
 */

export interface RequestScope {
  requestId: string;
  /** Absent on the public routes: /api/collect and /api/health have no session. */
  userId?: string;
}

const store = new AsyncLocalStorage<RequestScope>();

export function runInRequestScope<T>(scope: RequestScope, fn: () => T): T {
  return store.run(scope, fn);
}

export function currentRequestId(): string | undefined {
  return store.getStore()?.requestId;
}

export function currentUserId(): string | undefined {
  return store.getStore()?.userId;
}
