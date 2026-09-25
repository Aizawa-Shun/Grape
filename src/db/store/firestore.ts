import {
  AggregateField,
  Timestamp,
  type DocumentData,
  type Firestore,
  type Query as FirestoreQuery,
  type Transaction,
} from "firebase-admin/firestore";

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
 * The Store on Firestore.
 *
 * Three translations happen here and nowhere else:
 *
 * - Timestamps come back as Dates, all the way down, so no caller ever sees a
 *   Firestore type — the in-memory store and this one return the same shapes.
 * - `in` / `not-in` lists longer than Firestore's 30-value limit are split
 *   into several queries and merged, with ordering and the limit applied
 *   after the merge.
 * - Inside a transaction, reads go through the Transaction object and writes
 *   are queued on it, so the callback sees the same Collection interface.
 */

type Doc = { id: string } & Record<string, unknown>;

const IN_LIMIT = 30;

function fromFirestore(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(fromFirestore);
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, fromFirestore(inner)]));
}

function toDoc(id: string, data: DocumentData | undefined): Doc | null {
  return data ? ({ ...(fromFirestore(data) as object), id } as Doc) : null;
}

/** The stored body, without the id — Firestore keeps that as the document name. */
function body(doc: Record<string, unknown>): DocumentData {
  const rest = { ...doc };
  delete rest.id;
  return rest;
}

function compare(a: unknown, b: unknown): number {
  const left = a instanceof Date ? a.getTime() : a;
  const right = b instanceof Date ? b.getTime() : b;
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  return (left as number) < (right as number) ? -1 : 1;
}

function sortAndLimit(docs: Doc[], query: Query<Doc>): Doc[] {
  let result = docs;
  if (query.orderBy?.length) {
    const orders = query.orderBy;
    result = [...docs].sort((a, b) => {
      for (const [field, direction] of orders) {
        const order = compare(a[field], b[field]);
        if (order !== 0) return direction === "asc" ? order : -order;
      }
      return 0;
    });
  }
  return query.limit === undefined ? result : result.slice(0, query.limit);
}

/**
 * The query, split when an `in` list is over the limit. Returns one Firestore
 * query per chunk; the caller merges, then re-sorts and re-limits.
 */
function build(db: Firestore, name: CollectionName, query: Query<Doc> = {}): FirestoreQuery[] {
  const filters = query.where ?? [];
  const oversized = filters.findIndex(
    ([, op, value]) => (op === "in" || op === "not-in") && (value as unknown[]).length > IN_LIMIT,
  );

  const apply = (active: readonly Filter<Doc>[], withOrderAndLimit: boolean): FirestoreQuery => {
    let q: FirestoreQuery = db.collection(name);
    for (const [field, op, value] of active) q = q.where(field, op, value);
    if (withOrderAndLimit) {
      for (const [field, direction] of query.orderBy ?? []) q = q.orderBy(field, direction);
      if (query.limit !== undefined) q = q.limit(query.limit);
    }
    return q;
  };

  if (oversized === -1) return [apply(filters, true)];

  const [field, op, value] = filters[oversized];
  if (op === "not-in") {
    throw new Error(`not-in with more than ${IN_LIMIT} values is not supported (${name}.${field})`);
  }
  const values = value as unknown[];
  const chunks: FirestoreQuery[] = [];
  for (let i = 0; i < values.length; i += IN_LIMIT) {
    const chunk = [...filters];
    chunk[oversized] = [field, "in", values.slice(i, i + IN_LIMIT)];
    chunks.push(apply(chunk, false));
  }
  return chunks;
}

async function runQuery(
  db: Firestore,
  name: CollectionName,
  query: Query<Doc> = {},
  tx?: Transaction,
): Promise<Doc[]> {
  const queries = build(db, name, query);
  const snapshots = await Promise.all(queries.map((q) => (tx ? tx.get(q) : q.get())));
  const docs = snapshots.flatMap((snapshot) => snapshot.docs.map((d) => toDoc(d.id, d.data())!));
  return queries.length === 1 ? docs : sortAndLimit(docs, query);
}

function collection(db: Firestore, name: CollectionName, tx?: Transaction): Collection<Doc, never> {
  const ref = (id: string) => db.collection(name).doc(id);

  const write = (id: string, doc: Record<string, unknown>, mode: "create" | "set"): Doc => {
    const stored = { ...defaultsFor(name, new Date()), ...(normalize(doc) as object), id } as Doc;
    if (tx) {
      if (mode === "create") tx.create(ref(id), body(stored));
      else tx.set(ref(id), body(stored));
    }
    return stored;
  };

  return {
    async get(id) {
      const snapshot = tx ? await tx.get(ref(id)) : await ref(id).get();
      return toDoc(snapshot.id, snapshot.data());
    },
    async find(query) {
      return runQuery(db, name, query, tx);
    },
    async first(query) {
      return (await runQuery(db, name, { ...query, limit: 1 }, tx))[0] ?? null;
    },
    async count(where) {
      if (tx) throw new Error("count() is not available inside a transaction");
      const queries = build(db, name, { where });
      const totals = await Promise.all(queries.map(async (q) => (await q.count().get()).data().count));
      return totals.reduce((a, b) => a + b, 0);
    },
    async sum(field, where) {
      if (tx) throw new Error("sum() is not available inside a transaction");
      const queries = build(db, name, { where });
      const totals = await Promise.all(
        queries.map(async (q) => {
          const result = await q.aggregate({ total: AggregateField.sum(field) }).get();
          return result.data().total ?? 0;
        }),
      );
      return totals.reduce((a, b) => a + b, 0);
    },
    async insert(doc) {
      const id = (doc as { id?: string }).id ?? crypto.randomUUID();
      const stored = write(id, doc as Record<string, unknown>, "create");
      if (!tx) await ref(id).create(body(stored));
      return stored;
    },
    async set(id, doc) {
      const stored = write(id, doc as Record<string, unknown>, "set");
      if (!tx) await ref(id).set(body(stored));
      return stored;
    },
    async update(id, patch) {
      const changes = normalize(
        Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
      ) as DocumentData;
      delete changes.id;

      if (tx) {
        // No read here: Firestore requires every read in a transaction to
        // come before the first write, so a read inside update() would make a
        // second update in the same transaction fail. tx.update itself fails
        // the commit if the document is missing, and what comes back is only
        // the changes — callers inside a transaction read the document first
        // anyway, as they must.
        tx.update(ref(id), changes);
        return { ...(fromFirestore(changes) as object), id } as Doc;
      }

      try {
        await ref(id).update(changes);
      } catch (error) {
        // NOT_FOUND: the document does not exist. Nothing is created — the
        // same "no such row" answer an UPDATE … WHERE id = ? used to give.
        if ((error as { code?: number }).code === 5) return null;
        throw error;
      }
      const snapshot = await ref(id).get();
      return toDoc(id, snapshot.data());
    },
    async delete(id) {
      if (tx) tx.delete(ref(id));
      else await ref(id).delete();
    },
    async deleteWhere(where) {
      if (tx) throw new Error("deleteWhere() is not available inside a transaction");
      const doomed = await runQuery(db, name, { where });
      // BulkWriter rather than one batch: batches cap at 500 writes, and a
      // product's events can run to far more than that.
      const writer = db.bulkWriter();
      for (const doc of doomed) void writer.delete(ref(doc.id));
      await writer.close();
      return doomed.length;
    },
  };
}

function collections(db: Firestore, tx?: Transaction): CollectionSet {
  return Object.fromEntries(
    COLLECTION_NAMES.map((name) => [name, collection(db, name, tx)]),
  ) as unknown as CollectionSet;
}

export function createFirestoreStore(db: Firestore): Store {
  return {
    ...collections(db),
    runTransaction(fn) {
      return db.runTransaction((tx) => fn(collections(db, tx)));
    },
  };
}
