import type { Firestore } from "firebase-admin/firestore";
import { getDb } from "@/server/firebase/admin";
import type {
  FactCategory,
  FactSource,
  ProductFactInput,
  RecordType,
} from "@/lib/validation/product-fact";

/**
 * Product Facts と、それを生成したAI実行履歴。
 *
 * どちらも `products/{productId}` のサブコレクションに置く。
 * トップレベルに置いて productId で絞ると複合インデックスが必要になるため、
 * スコープが自然に閉じるサブコレクションを採用している。
 */

const FACTS = "facts";
const RUNS = "analysisRuns";

export interface ProductFact {
  id: string;
  productId: string;
  category: FactCategory;
  content: string;
  recordType: RecordType;
  source: FactSource;
  /** AIがその判断に至った根拠。手動入力の場合は undefined。 */
  evidence?: string;
  /** AIが参照した情報の取得元URL。 */
  sourceUrl?: string;
  /** 利用者が内容を確認した日時。未確認なら undefined。 */
  confirmedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** AI分析の実行履歴(監査用)。AIが何をして何をしなかったかを後から追えるようにする。 */
export interface AnalysisRun {
  id: string;
  productId: string;
  status: "succeeded" | "failed";
  /** 失敗時の理由。UIにそのまま表示して、捏造データで埋めないための情報。 */
  error?: string;
  model?: string;
  sourceUrl?: string;
  /** 対象URLの取得に成功したか。失敗時はAIがURL情報なしで判断したことを意味する。 */
  fetchedPage: boolean;
  factCount: number;
  startedAt: Date;
  finishedAt: Date;
}

function factsRef(productId: string, db: Firestore) {
  return db.collection("products").doc(productId).collection(FACTS);
}

function runsRef(productId: string, db: Firestore) {
  return db.collection("products").doc(productId).collection(RUNS);
}

function toFact(
  productId: string,
  doc: FirebaseFirestore.DocumentSnapshot
): ProductFact {
  const data = doc.data();
  if (!data) {
    throw new Error(`facts/${doc.id}: ドキュメントにデータがありません`);
  }
  return {
    id: doc.id,
    productId,
    category: data.category,
    content: data.content,
    recordType: data.recordType,
    source: data.source,
    evidence: data.evidence ?? undefined,
    sourceUrl: data.sourceUrl ?? undefined,
    confirmedAt: data.confirmedAt ? data.confirmedAt.toDate() : undefined,
    createdAt: data.createdAt.toDate(),
    updatedAt: data.updatedAt.toDate(),
  };
}

/** 指定プロダクトのFactを古い順に取得する(カテゴリ内の並びを安定させるため昇順)。 */
export async function listProductFacts(
  productId: string,
  db: Firestore = getDb()
): Promise<ProductFact[]> {
  const snapshot = await factsRef(productId, db).orderBy("createdAt", "asc").get();
  return snapshot.docs.map((doc) => toFact(productId, doc));
}

/** Factを1件追加する。 */
export async function insertProductFact(
  productId: string,
  input: ProductFactInput & {
    source: FactSource;
    evidence?: string;
    sourceUrl?: string;
  },
  db: Firestore = getDb()
): Promise<ProductFact> {
  const now = new Date();
  const ref = factsRef(productId, db).doc();
  const record = {
    category: input.category,
    content: input.content,
    recordType: input.recordType,
    source: input.source,
    evidence: input.evidence ?? null,
    sourceUrl: input.sourceUrl ?? null,
    confirmedAt: input.source === "user" ? now : null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(record);
  return {
    id: ref.id,
    productId,
    category: input.category,
    content: input.content,
    recordType: input.recordType,
    source: input.source,
    evidence: input.evidence,
    sourceUrl: input.sourceUrl,
    confirmedAt: input.source === "user" ? now : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

/** Factの内容・種別を更新する。利用者が編集した時点で確認済みとして扱う。 */
export async function updateProductFact(
  productId: string,
  factId: string,
  input: ProductFactInput,
  db: Firestore = getDb()
): Promise<{ changes: number }> {
  const ref = factsRef(productId, db).doc(factId);
  if (!(await ref.get()).exists) {
    return { changes: 0 };
  }
  const now = new Date();
  await ref.update({
    category: input.category,
    content: input.content,
    recordType: input.recordType,
    confirmedAt: now,
    updatedAt: now,
  });
  return { changes: 1 };
}

/** AIが出した内容を利用者が「これで合っている」と承認する。 */
export async function confirmProductFact(
  productId: string,
  factId: string,
  db: Firestore = getDb()
): Promise<{ changes: number }> {
  const ref = factsRef(productId, db).doc(factId);
  if (!(await ref.get()).exists) {
    return { changes: 0 };
  }
  const now = new Date();
  await ref.update({ confirmedAt: now, updatedAt: now });
  return { changes: 1 };
}

/** Factを削除する(AIの誤りを利用者が取り除けるようにする)。 */
export async function deleteProductFact(
  productId: string,
  factId: string,
  db: Firestore = getDb()
): Promise<{ changes: number }> {
  const ref = factsRef(productId, db).doc(factId);
  if (!(await ref.get()).exists) {
    return { changes: 0 };
  }
  await ref.delete();
  return { changes: 1 };
}

/** 直前のAI生成Factをすべて削除する(再分析時に重複させないため)。手動入力は残す。 */
export async function deleteAiFacts(
  productId: string,
  db: Firestore = getDb()
): Promise<number> {
  const snapshot = await factsRef(productId, db).where("source", "==", "ai").get();
  if (snapshot.empty) {
    return 0;
  }
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snapshot.size;
}

/** AI実行履歴を記録する。 */
export async function recordAnalysisRun(
  productId: string,
  run: Omit<AnalysisRun, "id" | "productId">,
  db: Firestore = getDb()
): Promise<string> {
  const ref = runsRef(productId, db).doc();
  await ref.set({
    status: run.status,
    error: run.error ?? null,
    model: run.model ?? null,
    sourceUrl: run.sourceUrl ?? null,
    fetchedPage: run.fetchedPage,
    factCount: run.factCount,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  });
  return ref.id;
}

/** 最新のAI実行履歴を取得する。未実行なら undefined。 */
export async function getLatestAnalysisRun(
  productId: string,
  db: Firestore = getDb()
): Promise<AnalysisRun | undefined> {
  const snapshot = await runsRef(productId, db)
    .orderBy("finishedAt", "desc")
    .limit(1)
    .get();
  const doc = snapshot.docs[0];
  if (!doc) {
    return undefined;
  }
  const data = doc.data();
  return {
    id: doc.id,
    productId,
    status: data.status,
    error: data.error ?? undefined,
    model: data.model ?? undefined,
    sourceUrl: data.sourceUrl ?? undefined,
    fetchedPage: data.fetchedPage,
    factCount: data.factCount,
    startedAt: data.startedAt.toDate(),
    finishedAt: data.finishedAt.toDate(),
  };
}
