import { describe, expect, it } from "vitest";
import { parseMarketInsightInput, aiResearchSchema } from "./market-insight";

describe("parseMarketInsightInput", () => {
  const valid = {
    category: "channel",
    content: "r/chessbeginners に初心者が集まっている",
    recordType: "fact",
  };

  it("正しい入力を受け付ける", () => {
    expect(parseMarketInsightInput(valid).success).toBe(true);
  });

  it("情報源URLは任意", () => {
    const result = parseMarketInsightInput(valid);
    expect(result.success && result.data.sourceUrl).toBeUndefined();
  });

  it("http/httpsのURLを受け付ける", () => {
    const result = parseMarketInsightInput({
      ...valid,
      sourceUrl: "https://reddit.com/r/chessbeginners",
    });
    expect(result.success && result.data.sourceUrl).toBe("https://reddit.com/r/chessbeginners");
  });

  it("空文字のURLを受け付ける(未入力として保存層で正規化される)", () => {
    expect(parseMarketInsightInput({ ...valid, sourceUrl: "" }).success).toBe(true);
  });

  it("http/https以外のURLを拒否する", () => {
    expect(parseMarketInsightInput({ ...valid, sourceUrl: "javascript:alert(1)" }).success).toBe(
      false
    );
    expect(parseMarketInsightInput({ ...valid, sourceUrl: "reddit.com" }).success).toBe(false);
  });

  it("空の内容を拒否する", () => {
    expect(parseMarketInsightInput({ ...valid, content: "   " }).success).toBe(false);
  });

  it("500文字を超える内容を拒否する", () => {
    expect(parseMarketInsightInput({ ...valid, content: "あ".repeat(501) }).success).toBe(false);
  });

  it("未知のカテゴリを拒否する", () => {
    expect(parseMarketInsightInput({ ...valid, category: "somethingElse" }).success).toBe(false);
  });

  it("事実/仮説/不明の3種別を受け付ける", () => {
    for (const recordType of ["fact", "hypothesis", "unknown"]) {
      expect(parseMarketInsightInput({ ...valid, recordType }).success).toBe(true);
    }
  });
});

describe("aiResearchSchema", () => {
  const insight = {
    category: "competitor",
    content: "Lichess が無料の代替手段として存在する",
    recordType: "fact",
    evidence: "公式サイトで無料提供を確認",
    sourceUrl: "https://lichess.org",
    sourceTitle: "lichess.org",
  };

  it("AIの調査結果形式を検証する", () => {
    expect(aiResearchSchema.safeParse({ insights: [insight] }).success).toBe(true);
  });

  it("根拠が無い項目を拒否する", () => {
    const { evidence: _evidence, ...withoutEvidence } = insight;
    expect(aiResearchSchema.safeParse({ insights: [withoutEvidence] }).success).toBe(false);
  });

  it("情報源が空でも受け付ける(裏付けが取れない場合があるため)", () => {
    expect(
      aiResearchSchema.safeParse({
        insights: [{ ...insight, recordType: "unknown", sourceUrl: "", sourceTitle: "" }],
      }).success
    ).toBe(true);
  });

  it("想定外のrecordTypeを拒否する", () => {
    expect(
      aiResearchSchema.safeParse({ insights: [{ ...insight, recordType: "probably" }] }).success
    ).toBe(false);
  });
});
