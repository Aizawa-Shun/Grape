import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "@/server/firebase/test-utils";
import {
  confirmMarketInsight,
  deleteMarketInsight,
  deleteUnconfirmedAiInsights,
  getLatestResearchRun,
  insertMarketInsight,
  listMarketInsights,
  recordResearchRun,
  updateMarketInsight,
} from "./market-insights";

const PRODUCT_ID = "product-1";

describe("market insights (Firestore)", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  it("初期状態では空", async () => {
    expect(await listMarketInsights(PRODUCT_ID, db)).toEqual([]);
  });

  it("手動追加した項目は最初から確認済みになる", async () => {
    const insight = await insertMarketInsight(
      PRODUCT_ID,
      {
        category: "channel",
        content: "Redditに集まっている",
        recordType: "fact",
        source: "user",
      },
      db
    );

    expect(insight.confirmedAt).toBeInstanceOf(Date);
    expect(insight.capturedAt).toBeInstanceOf(Date);
  });

  it("AI調査の項目は未確認で、情報源と取得日時を保持する", async () => {
    const capturedAt = new Date("2026-09-01T00:00:00Z");
    await insertMarketInsight(
      PRODUCT_ID,
      {
        category: "competitor",
        content: "Lichessが無料の代替手段",
        recordType: "fact",
        source: "ai",
        evidence: "公式サイトで確認",
        sourceUrl: "https://lichess.org",
        sourceTitle: "lichess.org",
        capturedAt,
      },
      db
    );

    const [insight] = await listMarketInsights(PRODUCT_ID, db);
    expect(insight.confirmedAt).toBeUndefined();
    expect(insight.sourceUrl).toBe("https://lichess.org");
    expect(insight.sourceTitle).toBe("lichess.org");
    expect(insight.capturedAt.toISOString()).toBe(capturedAt.toISOString());
    expect(insight.evidence).toBe("公式サイトで確認");
  });

  it("空文字の情報源URLは「情報源なし」として保存される", async () => {
    await insertMarketInsight(
      PRODUCT_ID,
      {
        category: "channel",
        content: "空文字URLのテスト",
        recordType: "fact",
        source: "user",
        sourceUrl: "",
      },
      db
    );

    expect((await listMarketInsights(PRODUCT_ID, db))[0].sourceUrl).toBeUndefined();
  });

  it("情報源が無い項目も保存できる(裏付けが取れなかった場合)", async () => {
    await insertMarketInsight(
      PRODUCT_ID,
      {
        category: "customerProblem",
        content: "具体的な不満の声は見つからなかった",
        recordType: "unknown",
        source: "ai",
        evidence: "検索したが該当する投稿が無かった",
      },
      db
    );

    const [insight] = await listMarketInsights(PRODUCT_ID, db);
    expect(insight.recordType).toBe("unknown");
    expect(insight.sourceUrl).toBeUndefined();
  });

  it("承認すると確認済みになる", async () => {
    const insight = await insertMarketInsight(
      PRODUCT_ID,
      { category: "targetCustomer", content: "AIの推測", recordType: "hypothesis", source: "ai" },
      db
    );

    expect((await confirmMarketInsight(PRODUCT_ID, insight.id, db)).changes).toBe(1);
    expect((await listMarketInsights(PRODUCT_ID, db))[0].confirmedAt).toBeInstanceOf(Date);
  });

  it("編集すると内容が変わり、確認済みになる", async () => {
    const insight = await insertMarketInsight(
      PRODUCT_ID,
      { category: "targetCustomer", content: "誤り", recordType: "hypothesis", source: "ai" },
      db
    );

    const { changes } = await updateMarketInsight(
      PRODUCT_ID,
      insight.id,
      {
        category: "channel",
        content: "利用者が直した内容",
        recordType: "fact",
        sourceUrl: "https://example.com",
      },
      db
    );
    expect(changes).toBe(1);

    const [updated] = await listMarketInsights(PRODUCT_ID, db);
    expect(updated.content).toBe("利用者が直した内容");
    expect(updated.category).toBe("channel");
    expect(updated.sourceUrl).toBe("https://example.com");
    expect(updated.confirmedAt).toBeInstanceOf(Date);
  });

  it("削除できる / 存在しないIDは changes: 0", async () => {
    const insight = await insertMarketInsight(
      PRODUCT_ID,
      { category: "channel", content: "削除対象", recordType: "fact", source: "user" },
      db
    );

    expect((await deleteMarketInsight(PRODUCT_ID, insight.id, db)).changes).toBe(1);
    expect(await listMarketInsights(PRODUCT_ID, db)).toEqual([]);
    expect((await deleteMarketInsight(PRODUCT_ID, "missing", db)).changes).toBe(0);
  });

  it("再調査時は未確認のAI分だけを削除し、確認済みと手動入力は残す", async () => {
    const unconfirmed = await insertMarketInsight(
      PRODUCT_ID,
      { category: "channel", content: "未確認のAI結果", recordType: "hypothesis", source: "ai" },
      db
    );
    const confirmed = await insertMarketInsight(
      PRODUCT_ID,
      { category: "channel", content: "確認済みのAI結果", recordType: "fact", source: "ai" },
      db
    );
    await confirmMarketInsight(PRODUCT_ID, confirmed.id, db);
    await insertMarketInsight(
      PRODUCT_ID,
      { category: "channel", content: "自分で書いた内容", recordType: "fact", source: "user" },
      db
    );

    const deleted = await deleteUnconfirmedAiInsights(PRODUCT_ID, db);
    expect(deleted).toBe(1);

    const remaining = await listMarketInsights(PRODUCT_ID, db);
    expect(remaining).toHaveLength(2);
    expect(remaining.map((i) => i.id)).not.toContain(unconfirmed.id);
  });

  it("プロダクトごとに市場情報が混ざらない", async () => {
    await insertMarketInsight(
      "product-a",
      { category: "channel", content: "Aの市場", recordType: "fact", source: "user" },
      db
    );
    await insertMarketInsight(
      "product-b",
      { category: "channel", content: "Bの市場", recordType: "fact", source: "user" },
      db
    );

    const a = await listMarketInsights("product-a", db);
    expect(a).toHaveLength(1);
    expect(a[0].content).toBe("Aの市場");
  });
});

describe("research runs (監査記録)", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  it("未実行なら undefined", async () => {
    expect(await getLatestResearchRun(PRODUCT_ID, db)).toBeUndefined();
  });

  it("成功時はWeb検索回数を含めて記録する", async () => {
    const started = new Date();
    await recordResearchRun(
      PRODUCT_ID,
      {
        status: "succeeded",
        model: "claude-opus-5",
        searchCount: 6,
        insightCount: 12,
        startedAt: started,
        finishedAt: new Date(started.getTime() + 60_000),
      },
      db
    );

    const run = await getLatestResearchRun(PRODUCT_ID, db);
    expect(run?.status).toBe("succeeded");
    expect(run?.searchCount).toBe(6);
    expect(run?.insightCount).toBe(12);
  });

  it("失敗時は理由を残す", async () => {
    const now = new Date();
    await recordResearchRun(
      PRODUCT_ID,
      {
        status: "failed",
        error: "APIのレート制限に達しました",
        searchCount: 0,
        insightCount: 0,
        startedAt: now,
        finishedAt: now,
      },
      db
    );

    const run = await getLatestResearchRun(PRODUCT_ID, db);
    expect(run?.status).toBe("failed");
    expect(run?.error).toBe("APIのレート制限に達しました");
  });

  it("最新の実行が返る", async () => {
    const base = new Date();
    await recordResearchRun(
      PRODUCT_ID,
      { status: "failed", error: "古い", searchCount: 0, insightCount: 0, startedAt: base, finishedAt: base },
      db
    );
    await recordResearchRun(
      PRODUCT_ID,
      {
        status: "succeeded",
        searchCount: 3,
        insightCount: 5,
        startedAt: base,
        finishedAt: new Date(base.getTime() + 10_000),
      },
      db
    );

    expect((await getLatestResearchRun(PRODUCT_ID, db))?.status).toBe("succeeded");
  });
});
