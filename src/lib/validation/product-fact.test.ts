import { describe, expect, it } from "vitest";
import { parseProductFactInput, aiAnalysisSchema } from "./product-fact";

describe("parseProductFactInput", () => {
  const valid = { category: "problem", content: "棋譜を振り返れない", recordType: "fact" };

  it("正しい入力を受け付ける", () => {
    const result = parseProductFactInput(valid);
    expect(result.success).toBe(true);
  });

  it("前後の空白を除去する", () => {
    const result = parseProductFactInput({ ...valid, content: "  課題  " });
    expect(result.success && result.data.content).toBe("課題");
  });

  it("空の内容を拒否する", () => {
    const result = parseProductFactInput({ ...valid, content: "   " });
    expect(result.success).toBe(false);
  });

  it("500文字を超える内容を拒否する", () => {
    const result = parseProductFactInput({ ...valid, content: "あ".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("未知のカテゴリを拒否する", () => {
    const result = parseProductFactInput({ ...valid, category: "unknownCategory" });
    expect(result.success).toBe(false);
  });

  it("未知の種別を拒否する(事実/仮説/不明 以外を保存させない)", () => {
    const result = parseProductFactInput({ ...valid, recordType: "guess" });
    expect(result.success).toBe(false);
  });

  it("3種類の種別をすべて受け付ける", () => {
    for (const recordType of ["fact", "hypothesis", "unknown"]) {
      expect(parseProductFactInput({ ...valid, recordType }).success).toBe(true);
    }
  });
});

describe("aiAnalysisSchema", () => {
  it("AIの出力形式を検証する", () => {
    const result = aiAnalysisSchema.safeParse({
      facts: [
        {
          category: "value",
          content: "棋譜を共有できる",
          recordType: "hypothesis",
          evidence: "トップページの記載から推測",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("根拠(evidence)が無いAI出力を拒否する", () => {
    const result = aiAnalysisSchema.safeParse({
      facts: [{ category: "value", content: "棋譜を共有できる", recordType: "fact" }],
    });
    expect(result.success).toBe(false);
  });

  it("想定外のrecordTypeを含むAI出力を拒否する", () => {
    const result = aiAnalysisSchema.safeParse({
      facts: [
        { category: "value", content: "x", recordType: "definitely", evidence: "根拠" },
      ],
    });
    expect(result.success).toBe(false);
  });
});
