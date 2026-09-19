import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * テスト用: Firestoreエミュレータ上に、ランダムなprojectIdで隔離された
 * Firestoreインスタンスを作成する。projectIdごとにエミュレータ内の名前空間が
 * 分かれるため、テストケース間でデータが混ざらない(SQLite時代のin-memory DBに相当)。
 *
 * `FIRESTORE_EMULATOR_HOST` が設定されている前提(`pnpm test` は
 * `firebase emulators:exec` 経由で実行し、自動的に設定される)。
 */
export function createTestDb() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST が設定されていません。`pnpm test` を使ってください" +
        "(Firestoreエミュレータ経由でテストを実行します)。"
    );
  }
  const projectId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const app = initializeApp({ projectId }, projectId);
  return getFirestore(app);
}
