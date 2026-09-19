import type { Firestore } from "firebase-admin/firestore";
import { getDb } from "@/server/firebase/admin";
import type { ProductInput } from "@/lib/validation/product";

const COLLECTION = "products";

/**
 * Product: ユーザーが登録するWebアプリ(Phase 2: Product Onboarding)。
 *
 * Firestoreの `products` コレクションに1ドキュメント=1プロダクトとして保存する。
 * ここに保存される値はユーザーが直接入力した Fact として扱う。
 * AIによる理解・仮説(Product Intelligence)はPhase 3で別コレクションとして追加し、
 * このデータと混在させない。
 */
export interface Product extends ProductInput {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

function collection(db: Firestore) {
  return db.collection(COLLECTION);
}

function docToProduct(doc: FirebaseFirestore.DocumentSnapshot): Product {
  const data = doc.data();
  if (!data) {
    throw new Error(`products/${doc.id}: ドキュメントにデータがありません`);
  }
  return {
    id: doc.id,
    name: data.name,
    url: data.url,
    description: data.description,
    targetCustomer: data.targetCustomer,
    problem: data.problem,
    createdAt: data.createdAt.toDate(),
    updatedAt: data.updatedAt.toDate(),
  };
}

/** 登録済みプロダクトを新しい順に一覧取得する。 */
export async function listProducts(db: Firestore = getDb()): Promise<Product[]> {
  const snapshot = await collection(db).orderBy("createdAt", "desc").get();
  return snapshot.docs.map(docToProduct);
}

/** IDを指定してプロダクトを1件取得する。存在しない場合は undefined。 */
export async function getProductById(
  id: string,
  db: Firestore = getDb()
): Promise<Product | undefined> {
  const doc = await collection(db).doc(id).get();
  return doc.exists ? docToProduct(doc) : undefined;
}

/** 新規プロダクトを1件作成する。作成したレコードを返す。 */
export async function insertProduct(
  input: ProductInput,
  db: Firestore = getDb()
): Promise<Product> {
  const now = new Date();
  const ref = collection(db).doc();
  await ref.set({ ...input, createdAt: now, updatedAt: now });
  return { id: ref.id, ...input, createdAt: now, updatedAt: now };
}

/** 既存プロダクトを更新する。対象が存在しなかった場合は changes: 0 を返す。 */
export async function updateProductRecord(
  id: string,
  input: ProductInput,
  db: Firestore = getDb()
): Promise<{ changes: number }> {
  const ref = collection(db).doc(id);
  const existing = await ref.get();
  if (!existing.exists) {
    return { changes: 0 };
  }
  await ref.update({ ...input, updatedAt: new Date() });
  return { changes: 1 };
}
