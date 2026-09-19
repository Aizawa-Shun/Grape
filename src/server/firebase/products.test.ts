import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "@/server/firebase/test-utils";
import {
  listProducts,
  getProductById,
  insertProduct,
  updateProductRecord,
} from "./products";
import type { ProductInput } from "@/lib/validation/product";

const sample: ProductInput = {
  name: "Cheeeess",
  url: "https://cheeeess.com",
  description: "チェスの棋譜を記録・共有できるWebアプリ",
  targetCustomer: "チェスを学び始めた初心者",
  problem: "棋譜を人に見せて相談する手段が無い",
};

describe("products queries (Firestore)", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  it("初期状態では一覧が空", async () => {
    expect(await listProducts(db)).toEqual([]);
  });

  it("作成したプロダクトを一覧・詳細で取得できる", async () => {
    const created = await insertProduct(sample, db);

    const list = await listProducts(db);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
    expect(list[0].name).toBe("Cheeeess");

    const found = await getProductById(created.id, db);
    expect(found?.url).toBe("https://cheeeess.com");
  });

  it("存在しないIDはundefinedを返す", async () => {
    expect(await getProductById("does-not-exist", db)).toBeUndefined();
  });

  it("再読み込み相当(別クエリ)でもデータが保持されている", async () => {
    const created = await insertProduct(sample, db);
    const reFetched = await getProductById(created.id, db);
    expect(reFetched).toEqual(created);
  });

  it("プロダクトを更新すると内容が反映される", async () => {
    const created = await insertProduct(sample, db);

    const { changes } = await updateProductRecord(
      created.id,
      { ...sample, description: "更新後の概要" },
      db
    );
    expect(changes).toBe(1);

    const updated = await getProductById(created.id, db);
    expect(updated?.description).toBe("更新後の概要");
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it("存在しないIDの更新は changes: 0 を返す", async () => {
    const { changes } = await updateProductRecord("does-not-exist", sample, db);
    expect(changes).toBe(0);
  });

  it("一覧は新しい順(createdAt降順)に並ぶ", async () => {
    const first = await insertProduct(sample, db);
    await new Promise((r) => setTimeout(r, 10));
    const second = await insertProduct({ ...sample, name: "Second" }, db);

    const list = await listProducts(db);
    expect(list.map((p) => p.id)).toEqual([second.id, first.id]);
  });
});
