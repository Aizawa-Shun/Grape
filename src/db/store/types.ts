import type { CollectionName, Collections } from "../schema";

/**
 * The whole of what Grape asks of a database, stated once so there can be two
 * implementations of it: Firestore (store/firestore.ts), which is what runs,
 * and an in-memory one (store/memory.ts), which is what most tests run on.
 * store/contract.test.ts holds both to the same behaviour.
 *
 * Deliberately no more than Firestore can do natively: equality and range
 * filters, ordering, a limit, count and sum. Anything that used to be a join,
 * a GROUP BY or a correlated subquery is now a second query and a few lines
 * of code at the call site — written there, where it is visible, rather than
 * emulated here where it would look cheaper than it is.
 */

export type Op = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in";

type FieldOf<T> = Extract<keyof T, string>;

export type Filter<T> = readonly [field: FieldOf<T>, op: Op, value: unknown];
export type Order<T> = readonly [field: FieldOf<T>, direction: "asc" | "desc"];

export interface Query<T> {
  where?: readonly Filter<T>[];
  orderBy?: readonly Order<T>[];
  limit?: number;
}

/**
 * What an insert has to supply: everything the collection's defaults do not.
 * `id` is optional everywhere — omitted, a random UUID is used (the ingest
 * endpoint validates product ids as UUIDs, so ids keep that shape) — and
 * required in practice only where the id means something, like a user's uid
 * or a setting's key.
 */
export type NewDoc<T extends { id: string }, D extends keyof T> = Omit<T, "id" | D> &
  Partial<Pick<T, D>> & { id?: string };

export interface Collection<T extends { id: string }, D extends keyof T = never> {
  get(id: string): Promise<T | null>;
  find(query?: Query<T>): Promise<T[]>;
  first(query?: Query<T>): Promise<T | null>;
  count(where?: readonly Filter<T>[]): Promise<number>;
  sum(field: FieldOf<T>, where?: readonly Filter<T>[]): Promise<number>;
  insert(doc: NewDoc<T, D>): Promise<T>;
  /** Creates or replaces the document with this id. */
  set(id: string, doc: NewDoc<T, D>): Promise<T>;
  /**
   * Null when there is no such document; nothing is created. Inside a
   * transaction the result holds only the changed fields (see
   * store/firestore.ts) — read the document first if you need the rest.
   */
  update(id: string, patch: Partial<Omit<T, "id">>): Promise<T | null>;
  delete(id: string): Promise<void>;
  /** Deletes every match; returns how many. */
  deleteWhere(where: readonly Filter<T>[]): Promise<number>;
}

/**
 * The fields each collection fills in when an insert leaves them out —
 * timestamps, statuses, empty arrays. Kept with the store rather than at every
 * call site, the way column defaults used to be kept with the schema.
 */
export interface Defaults {
  users: "role" | "anthropicApiKey" | "openaiApiKey" | "createdAt" | "lastLoginAt";
  invites: "invitedBy" | "usedAt" | "usedBy" | "createdAt";
  products: "keyEventName" | "setupStatus" | "setupError" | "setupClaimedAt" | "createdAt";
  productContexts: "confidence" | "gaps" | "analysis" | "primaryLanguage" | "editedByHuman" | "createdAt";
  crawlPages: "title" | "text" | "meta" | "renderedWith" | "fetchedAt";
  events: "path" | "referrer" | "utm";
  diagnoses: "evidence" | "confidence" | "model" | "createdAt";
  tasks: "diagnosisId" | "channel" | "expectedDirection" | "status" | "createdAt" | "completedAt";
  artifacts: "createdAt";
  actionRuns:
    | "artifactId"
    | "status"
    | "externalUrl"
    | "costEstimateUsd"
    | "response"
    | "approvedAt"
    | "executedAt"
    | "createdAt";
  outcomes: "evaluatedAt";
  llmCalls: "productId" | "userId" | "cacheReadInputTokens" | "cacheCreationInputTokens" | "createdAt";
  settings: "updatedAt";
}

export type CollectionSet = {
  [K in CollectionName]: Collection<Collections[K], Extract<Defaults[K], keyof Collections[K]>>;
};

/**
 * A Store is the set of collections plus a transaction. Inside
 * `runTransaction`, the store handed to the callback reads and writes
 * atomically — with Firestore's rule that every read comes before the first
 * write, which the in-memory store does not enforce but callers must respect.
 */
export interface Store extends CollectionSet {
  runTransaction<R>(fn: (tx: CollectionSet) => Promise<R>): Promise<R>;
}

export function defaultsFor(name: CollectionName, now: Date): Record<string, unknown> {
  switch (name) {
    case "users":
      return { role: "member", anthropicApiKey: null, openaiApiKey: null, createdAt: now, lastLoginAt: null };
    case "invites":
      return { invitedBy: null, usedAt: null, usedBy: null, createdAt: now };
    case "products":
      return { keyEventName: null, setupStatus: "ready", setupError: null, setupClaimedAt: null, createdAt: now };
    case "productContexts":
      return {
        confidence: null,
        gaps: [],
        analysis: null,
        primaryLanguage: null,
        editedByHuman: false,
        createdAt: now,
      };
    case "crawlPages":
      return { title: null, text: null, meta: null, renderedWith: "static", fetchedAt: now };
    case "events":
      return { path: null, referrer: null, utm: null };
    case "diagnoses":
      return { evidence: null, confidence: null, model: null, createdAt: now };
    case "tasks":
      return {
        diagnosisId: null,
        channel: "manual",
        expectedDirection: "up",
        status: "proposed",
        createdAt: now,
        completedAt: null,
      };
    case "artifacts":
      return { createdAt: now };
    case "actionRuns":
      return {
        artifactId: null,
        status: "pending",
        externalUrl: null,
        costEstimateUsd: null,
        response: null,
        approvedAt: null,
        executedAt: null,
        createdAt: now,
      };
    case "outcomes":
      return { evaluatedAt: now };
    case "llmCalls":
      return { productId: null, userId: null, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, createdAt: now };
    case "settings":
      return { updatedAt: now };
  }
}

/**
 * Replaces `undefined` with `null` all the way down. Firestore rejects
 * `undefined` outright, and a field left out entirely would then not match a
 * `== null` filter — so an optional value a caller forgot to set becomes an
 * explicit null in both stores alike.
 */
export function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || value instanceof Date || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, normalize(inner)]));
}
