import { COLLECTION_NAMES, type CollectionName } from "../schema";
import {
  defaultsFor,
  normalize,
  type Collection,
  type CollectionSet,
  type Filter,
  type Query,
  type Store,
} from "./types";

/**
 * A Store held in a Map, for tests. Values are cloned on the way in and out
 * so a caller mutating what it got back cannot change what is stored — the
 * same isolation a real database gives, which is what the tests are standing
 * in for.
 *
 * Matching follows Firestore where the two could plausibly differ: `null` is
 * a value `==` can match, range filters and ordering compare Dates by time,
 * and `!=` / `not-in` never match a null field.
 */

type Doc = { id: string } & Record<string, unknown>;

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function compare(a: unknown, b: unknown): number {
  const left = comparable(a);
  const right = comparable(b);
  if (left === right) return 0;
  // Firestore orders null before every other value.
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  return (left as number) < (right as number) ? -1 : 1;
}

function matches(doc: Doc, [field, op, value]: Filter<Doc>): boolean {
  const actual = doc[field];
  switch (op) {
    case "==":
      return compare(actual, value) === 0 && (actual === null) === (value === null);
    case "!=":
      return actual !== null && compare(actual, value) !== 0;
    case "<":
      return actual !== null && compare(actual, value) < 0;
    case "<=":
      return actual !== null && compare(actual, value) <= 0;
    case ">":
      return actual !== null && compare(actual, value) > 0;
    case ">=":
      return actual !== null && compare(actual, value) >= 0;
    case "in":
      return (value as unknown[]).some((candidate) => compare(actual, candidate) === 0);
    case "not-in":
      return actual !== null && !(value as unknown[]).some((candidate) => compare(actual, candidate) === 0);
  }
}

function applyQuery(docs: Doc[], query: Query<Doc> = {}): Doc[] {
  let result = docs.filter((doc) => (query.where ?? []).every((filter) => matches(doc, filter)));
  if (query.orderBy?.length) {
    const orders = query.orderBy;
    result = [...result].sort((a, b) => {
      for (const [field, direction] of orders) {
        const order = compare(a[field], b[field]);
        if (order !== 0) return direction === "asc" ? order : -order;
      }
      return 0;
    });
  }
  return query.limit === undefined ? result : result.slice(0, query.limit);
}

function collection(name: CollectionName, data: Map<string, Doc>): Collection<Doc, never> {
  const read = (doc: Doc | undefined) => (doc ? structuredClone(doc) : null);

  const write = (id: string, doc: Record<string, unknown>): Doc => {
    const stored = { ...defaultsFor(name, new Date()), ...(normalize(doc) as object), id } as Doc;
    data.set(id, structuredClone(stored));
    return structuredClone(stored);
  };

  return {
    async get(id) {
      return read(data.get(id));
    },
    async find(query) {
      return applyQuery([...data.values()], query).map((doc) => structuredClone(doc));
    },
    async first(query) {
      return read(applyQuery([...data.values()], { ...query, limit: 1 })[0]);
    },
    async count(where) {
      return applyQuery([...data.values()], { where }).length;
    },
    async sum(field, where) {
      return applyQuery([...data.values()], { where }).reduce(
        (total, doc) => total + (typeof doc[field] === "number" ? (doc[field] as number) : 0),
        0,
      );
    },
    async insert(doc) {
      const id = (doc as { id?: string }).id ?? crypto.randomUUID();
      if (data.has(id)) throw new Error(`${name}/${id} already exists`);
      return write(id, doc as Record<string, unknown>);
    },
    async set(id, doc) {
      return write(id, doc as Record<string, unknown>);
    },
    async update(id, patch) {
      const current = data.get(id);
      if (!current) return null;
      const changes = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      );
      const next = { ...current, ...(normalize(changes) as object), id } as Doc;
      data.set(id, structuredClone(next));
      return structuredClone(next);
    },
    async delete(id) {
      data.delete(id);
    },
    async deleteWhere(where) {
      const doomed = applyQuery([...data.values()], { where });
      for (const doc of doomed) data.delete(doc.id);
      return doomed.length;
    },
  };
}

export function createMemoryStore(): Store {
  const tables = new Map<CollectionName, Map<string, Doc>>(
    COLLECTION_NAMES.map((name) => [name, new Map()]),
  );

  const build = (): CollectionSet =>
    Object.fromEntries(
      COLLECTION_NAMES.map((name) => [name, collection(name, tables.get(name)!)]),
    ) as unknown as CollectionSet;

  const collections = build();

  // Transactions run one at a time and roll back on a throw, by snapshotting
  // every table first. Cheap at test sizes, and enough to make a failed
  // transaction leave nothing behind — which is the property callers rely on.
  let queue: Promise<unknown> = Promise.resolve();

  return {
    ...collections,
    runTransaction<R>(fn: (tx: CollectionSet) => Promise<R>): Promise<R> {
      const run = queue.then(async () => {
        const snapshot = new Map(
          [...tables].map(([name, table]) => [name, structuredClone(new Map(table))]),
        );
        try {
          return await fn(collections);
        } catch (error) {
          for (const [name, table] of snapshot) {
            const live = tables.get(name)!;
            live.clear();
            for (const [id, doc] of table) live.set(id, doc);
          }
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
