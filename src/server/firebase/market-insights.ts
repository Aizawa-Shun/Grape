import type { Firestore } from "firebase-admin/firestore";
import { getDb } from "@/server/firebase/admin";
import type { FactSource, RecordType } from "@/lib/validation/product-fact";
import type { InsightCategory, MarketInsightInput } from "@/lib/validation/market-insight";

/**
 * Market Insights と、それを生成した調査実行の履歴。
 *
 * Product Facts(Phase 3)と同じく `products/{productId}` のサブコレクションに置く。
 * 市場情報は対象プロダクトごとに意味が変わるため、プロダクト単位でスコープする。
 */

const INSIGHTS = "marketInsights";
const RUNS = "researchRuns";

export interface MarketInsight {
  id: string;
  productId: string;
  category: InsightCategory;
  content: string;
  recordType: RecordType;
  source: FactSource;
  /** その判断に至った根拠。 */
  evidence?: string;
  /** 参照した情報源のURL。裏付けが取れなかった場合は undefined。 */
  sourceUrl?: string;
  /** 情報源のページタイトル。 */
  sourceTitle?: string;
  /** 情報を取得した日時。市場情報は古くなるため必ず保持する。 */
  capturedAt: Date;
  confirmedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** 市場調査の実行履歴(監査用)。 */
export interface ResearchRun {
  id: string;
  productId: string;
  status: "succeeded" | "failed";
  error?: string;
  model?: string;
  /** AIが実際にWeb検索を行った回数。0なら検索なしで回答している。 */
  searchCount: number;
  insightCount: number;
  startedAt: Date;
  finishedAt: Date;
}

function insightsRef(productId: string, db: Firestore) {
  return db.collection("products").doc(productId).collection(INSIGHTS);
}

function runsRef(productId: string, db: Firestore) {
  return db.collection("products").doc(productId).collection(RUNS);
}

function toInsight(
  productId: string,
  doc: FirebaseFirestore.DocumentSnapshot
): MarketInsight {
  const data = doc.data();
  if (!data) {
    throw new Error(`marketInsights/${doc.id}: ドキュメントにデータがありません`);
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
    sourceTitle: data.sourceTitle ?? undefined,
    capturedAt: data.capturedAt.toDate(),
    confirmedAt: data.confirmedAt ? data.confirmedAt.toDate() : undefined,
    createdAt: data.createdAt.toDate(),
    updatedAt: data.updatedAt.toDate(),
  };
}

/** 指定プロダクトの市場情報を古い順に取得する。 */
export async function listMarketInsights(
  productId: string,
  db: Firestore = getDb()
): Promise<MarketInsight[]> {
  const snapshot = await insightsRef(productId, db).orderBy("createdAt", "asc").get();
  return snapshot.docs.map((doc) => toInsight(productId, doc));
}

/** 市場情報を1件追加する。 */
export async function insertMarketInsight(
  productId: string,
  input: MarketInsightInput & {
    source: FactSource;
    evidence?: string;
    sourceTitle?: string;
    capturedAt?: Date;
  },
  db: Firestore = getDb()
): Promise<MarketInsight> {
  const now = new Date();
  const capturedAt = input.capturedAt ?? now;
  const ref = insightsRef(productId, db).doc();

  await ref.set({
    category: input.category,
    content: input.content,
    recordType: input.recordType,
    source: input.source,
    evidence: input.evidence ?? null,
    sourceUrl: input.sourceUrl || null,
    sourceTitle: input.sourceTitle || null,
    capturedAt,
    confirmedAt: input.source === "user" ? now : null,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id: ref.id,
    productId,
    category: input.category,
    content: input.content,
    recordType: input.recordType,
    source: input.source,
    evidence: input.evidence,
    sourceUrl: input.sourceUrl || undefined,
    sourceTitle: input.sourceTitle || undefined,
    capturedAt,
    confirmedAt: input.source === "user" ? now : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

/** 市場情報を更新する。利用者が編集した時点で確認済みとして扱う。 */
export async function updateMarketInsight(
  productId: string,
  insightId: string,
  input: MarketInsightInput,
  db: Firestore = getDb()
): Promise<{ changes: number }> {
  const ref = insightsRef(productId, db).doc(insightId);
  if (!(await ref.get()).exists) {
    return { changes: 0 };
  }
  const now = new Date();
  await ref.update({
    category: input.category,
    content: input.content,
    recordType: input.recordType,
    sourceUrl: input.sourceUrl || null,
    confirmedAt: now,
    updatedAt: now,
  });
  return { changes: 1 };
}

/** AIが出した内容を利用者が承認する。 */
export async function confirmMarketInsight(
  productId: string,
  insightId: string,
  db: Firestore = getDb()
): Promise<{ changes: number }> {
  const ref = insightsRef(productId, db).doc(insightId);
  if (!(await ref.get()).exists) {
    return { changes: 0 };
  }
  const now = new Date();
  await ref.update({ confirmedAt: now, updatedAt: now });
  return { changes: 1 };
}

/** 市場情報を削除する。 */
export async function deleteMarketInsight(
  productId: string,
  insightId: string,
  db: Firestore = getDb()
): Promise<{ changes: number }> {
  const ref = insightsRef(productId, db).doc(insightId);
  if (!(await ref.get()).exists) {
    return { changes: 0 };
  }
  await ref.delete();
  return { changes: 1 };
}

/** 再調査時にAI生成分だけを削除する。手動入力と確認済みの内容は残す。 */
export async function deleteUnconfirmedAiInsights(
  productId: string,
  db: Firestore = getDb()
): Promise<number> {
  const snapshot = await insightsRef(productId, db).where("source", "==", "ai").get();
  const targets = snapshot.docs.filter((doc) => !doc.data().confirmedAt);
  if (targets.length === 0) {
    return 0;
  }
  const batch = db.batch();
  targets.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return targets.length;
}

/** 調査の実行履歴を記録する。 */
export async function recordResearchRun(
  productId: string,
  run: Omit<ResearchRun, "id" | "productId">,
  db: Firestore = getDb()
): Promise<string> {
  const ref = runsRef(productId, db).doc();
  await ref.set({
    status: run.status,
    error: run.error ?? null,
    model: run.model ?? null,
    searchCount: run.searchCount,
    insightCount: run.insightCount,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  });
  return ref.id;
}

/** 最新の調査実行履歴を取得する。未実行なら undefined。 */
export async function getLatestResearchRun(
  productId: string,
  db: Firestore = getDb()
): Promise<ResearchRun | undefined> {
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
    searchCount: data.searchCount,
    insightCount: data.insightCount,
    startedAt: data.startedAt.toDate(),
    finishedAt: data.finishedAt.toDate(),
  };
}
