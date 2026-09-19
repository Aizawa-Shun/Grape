import { describe, expect, it } from "vitest";
import { parseProductInput } from "./product";

const validInput = {
  name: "Cheeeess",
  url: "example.com",
  description: "チェスの棋譜を共有できるWebアプリ",
  targetCustomer: "チェスを学びたい初心者",
  problem: "棋譜を人に見せて相談する手段が無い",
};

describe("parseProductInput", () => {
  it("有効な入力を受け付ける", () => {
    const result = parseProductInput(validInput);
    expect(result.success).toBe(true);
  });

  it("スキーム無しのURLに https:// を補う", () => {
    const result = parseProductInput(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe("https://example.com");
    }
  });

  it("既にスキームがあるURLはそのまま使う", () => {
    const result = parseProductInput({ ...validInput, url: "http://example.com/app" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe("http://example.com/app");
    }
  });

  it("プロダクト名が空なら失敗する", () => {
    const result = parseProductInput({ ...validInput, name: "  " });
    expect(result.success).toBe(false);
  });

  it("不正なURLは失敗する", () => {
    const result = parseProductInput({ ...validInput, url: "not a url" });
    expect(result.success).toBe(false);
  });

  it("サービス概要が空なら失敗する", () => {
    const result = parseProductInput({ ...validInput, description: "" });
    expect(result.success).toBe(false);
  });

  it("想定顧客が空なら失敗する", () => {
    const result = parseProductInput({ ...validInput, targetCustomer: "" });
    expect(result.success).toBe(false);
  });

  it("解決する課題が空なら失敗する", () => {
    const result = parseProductInput({ ...validInput, problem: "" });
    expect(result.success).toBe(false);
  });

  it("文字数上限を超えると失敗する", () => {
    const result = parseProductInput({ ...validInput, name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });
});
