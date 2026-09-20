import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "@/server/firebase/test-utils";
import {
  confirmProductFact,
  deleteAiFacts,
  deleteProductFact,
  getLatestAnalysisRun,
  insertProductFact,
  listProductFacts,
  recordAnalysisRun,
  updateProductFact,
} from "./product-facts";

const PRODUCT_ID = "product-1";

describe("product facts (Firestore)", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  it("初期状態では空", async () => {
    expect(await listProductFacts(PRODUCT_ID, db)).toEqual([]);
  });

  it("手動追加したFactは最初から確認済みになる", async () => {
    const fact = await insertProductFact(
      PRODUCT_ID,
      { category: "problem", content: "棋譜を振り返れない", recordType: "fact", source: "user" },
      db
    );

    expect(fact.confirmedAt).toBeInstanceOf(Date);

    const list = await listProductFacts(PRODUCT_ID, db);
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("棋譜を振り返れない");
    expect(list[0].source).toBe("user");
  });

  it("AIが追加したFactは未確認で、根拠と取得元を保持する", async () => {
    await insertProductFact(
      PRODUCT_ID,
      {
        category: "value",
        content: "棋譜を共有できる",
        recordType: "hypothesis",
        source: "ai",
        evidence: "トップページに共有機能の記載があるため",
        sourceUrl: "https://cheeeess.com",
      },
      db
    );

    const [fact] = await listProductFacts(PRODUCT_ID, db);
    expect(fact.confirmedAt).toBeUndefined();
    expect(fact.recordType).toBe("hypothesis");
    expect(fact.evidence).toBe("トップページに共有機能の記載があるため");
    expect(fact.sourceUrl).toBe("https://cheeeess.com");
  });

  it("不明(unknown)も記録できる", async () => {
    await insertProductFact(
      PRODUCT_ID,
      {
        category: "targetCustomer",
        content: "価格帯から想定される顧客層が読み取れない",
        recordType: "unknown",
        source: "ai",
        evidence: "サイトに価格の記載が無いため",
      },
      db
    );

    const [fact] = await listProductFacts(PRODUCT_ID, db);
    expect(fact.recordType).toBe("unknown");
  });

  it("承認すると確認済みになる", async () => {
    const fact = await insertProductFact(
      PRODUCT_ID,
      { category: "problem", content: "AIの推測", recordType: "hypothesis", source: "ai" },
      db
    );
    expect((await listProductFacts(PRODUCT_ID, db))[0].confirmedAt).toBeUndefined();

    const { changes } = await confirmProductFact(PRODUCT_ID, fact.id, db);
    expect(changes).toBe(1);
    expect((await listProductFacts(PRODUCT_ID, db))[0].confirmedAt).toBeInstanceOf(Date);
  });

  it("編集すると内容が変わり、確認済みになる", async () => {
    const fact = await insertProductFact(
      PRODUCT_ID,
      { category: "problem", content: "誤った推測", recordType: "hypothesis", source: "ai" },
      db
    );

    const { changes } = await updateProductFact(
      PRODUCT_ID,
      fact.id,
      { category: "value", content: "利用者が直した内容", recordType: "fact" },
      db
    );
    expect(changes).toBe(1);

    const [updated] = await listProductFacts(PRODUCT_ID, db);
    expect(updated.content).toBe("利用者が直した内容");
    expect(updated.category).toBe("value");
    expect(updated.recordType).toBe("fact");
    expect(updated.confirmedAt).toBeInstanceOf(Date);
  });

  it("削除できる / 存在しないIDは changes: 0", async () => {
    const fact = await insertProductFact(
      PRODUCT_ID,
      { category: "feature", content: "削除対象", recordType: "fact", source: "user" },
      db
    );

    expect((await deleteProductFact(PRODUCT_ID, fact.id, db)).changes).toBe(1);
    expect(await listProductFacts(PRODUCT_ID, db)).toEqual([]);
    expect((await deleteProductFact(PRODUCT_ID, "missing", db)).changes).toBe(0);
  });

  it("再分析時、AI生成分だけを削除し手動入力は残す", async () => {
    await insertProductFact(
      PRODUCT_ID,
      { category: "problem", content: "AIの出力", recordType: "hypothesis", source: "ai" },
      db
    );
    await insertProductFact(
      PRODUCT_ID,
      { category: "problem", content: "自分で書いた内容", recordType: "fact", source: "user" },
      db
    );

    const deleted = await deleteAiFacts(PRODUCT_ID, db);
    expect(deleted).toBe(1);

    const remaining = await listProductFacts(PRODUCT_ID, db);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].source).toBe("user");
  });

  it("プロダクトごとにFactが混ざらない", async () => {
    await insertProductFact(
      "product-a",
      { category: "problem", content: "Aの課題", recordType: "fact", source: "user" },
      db
    );
    await insertProductFact(
      "product-b",
      { category: "problem", content: "Bの課題", recordType: "fact", source: "user" },
      db
    );

    expect((await listProductFacts("product-a", db))[0].content).toBe("Aの課題");
    expect(await listProductFacts("product-a", db)).toHaveLength(1);
  });
});

describe("analysis runs (監査記録)", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  it("未実行なら undefined", async () => {
    expect(await getLatestAnalysisRun(PRODUCT_ID, db)).toBeUndefined();
  });

  it("成功時の実行内容を記録し、最新を取得できる", async () => {
    const started = new Date();
    await recordAnalysisRun(
      PRODUCT_ID,
      {
        status: "succeeded",
        model: "claude-opus-5",
        sourceUrl: "https://cheeeess.com",
        fetchedPage: true,
        factCount: 7,
        startedAt: started,
        finishedAt: new Date(started.getTime() + 5000),
      },
      db
    );

    const run = await getLatestAnalysisRun(PRODUCT_ID, db);
    expect(run?.status).toBe("succeeded");
    expect(run?.factCount).toBe(7);
    expect(run?.fetchedPage).toBe(true);
    expect(run?.model).toBe("claude-opus-5");
  });

  it("失敗時は理由を残す(AIが実行しなかったことを追跡できる)", async () => {
    const now = new Date();
    await recordAnalysisRun(
      PRODUCT_ID,
      {
        status: "failed",
        error: "APIキーが無効です",
        fetchedPage: false,
        factCount: 0,
        startedAt: now,
        finishedAt: now,
      },
      db
    );

    const run = await getLatestAnalysisRun(PRODUCT_ID, db);
    expect(run?.status).toBe("failed");
    expect(run?.error).toBe("APIキーが無効です");
    expect(run?.factCount).toBe(0);
  });

  it("最新の実行が返る", async () => {
    const base = new Date();
    await recordAnalysisRun(
      PRODUCT_ID,
      {
        status: "failed",
        error: "古い失敗",
        fetchedPage: false,
        factCount: 0,
        startedAt: base,
        finishedAt: base,
      },
      db
    );
    await recordAnalysisRun(
      PRODUCT_ID,
      {
        status: "succeeded",
        fetchedPage: true,
        factCount: 3,
        startedAt: base,
        finishedAt: new Date(base.getTime() + 10_000),
      },
      db
    );

    expect((await getLatestAnalysisRun(PRODUCT_ID, db))?.status).toBe("succeeded");
  });
});
