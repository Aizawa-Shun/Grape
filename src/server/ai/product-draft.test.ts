import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * 下書き生成が、取得できなかった項目を捏造せず空欄のまま返すこと、
 * およびページ取得の失敗が呼び出し側に伝わることを検証する。
 * Anthropic SDK と fetch-page はモックし、ネットワークアクセスは行わない。
 */

const mockParse = vi.fn();
const mockFetchPageText = vi.fn();

vi.mock("@/server/ai/client", () => ({
  AI_MODEL: "claude-opus-5",
  getAnthropicClient: () => ({ beta: { messages: { parse: mockParse } } }),
}));

vi.mock("@/server/ai/fetch-page", async () => {
  const actual = await vi.importActual<typeof import("@/server/ai/fetch-page")>(
    "@/server/ai/fetch-page"
  );
  return { ...actual, fetchPageText: mockFetchPageText };
});

const { draftProductFromUrl, DraftRefusedError } = await import("./product-draft");
const { PageFetchError } = await import("./fetch-page");

const page = {
  url: "https://example.com/",
  title: "Example",
  text: "ページ本文",
  truncated: false,
  metadataOnly: false,
};

beforeEach(() => {
  mockParse.mockReset();
  mockFetchPageText.mockReset();
  mockFetchPageText.mockResolvedValue(page);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("draftProductFromUrl", () => {
  it("4項目を抽出して返す", async () => {
    mockParse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: {
        name: "Cheeeess",
        description: "棋譜を共有できるアプリ",
        targetCustomer: "チェス初心者",
        problem: "棋譜を相談できない",
      },
    });

    const result = await draftProductFromUrl("example.com");
    expect(result.draft.name).toBe("Cheeeess");
    expect(result.draft.targetCustomer).toBe("チェス初心者");
    expect(result.url).toBe("https://example.com/");
  });

  it("前後の空白を除去する", async () => {
    mockParse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: {
        name: "  Cheeeess  ",
        description: " 概要 ",
        targetCustomer: " 顧客 ",
        problem: " 課題 ",
      },
    });

    const result = await draftProductFromUrl("example.com");
    expect(result.draft.name).toBe("Cheeeess");
    expect(result.draft.description).toBe("概要");
  });

  it("読み取れなかった項目は空欄のまま返す(捏造しない)", async () => {
    mockParse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: {
        name: "Cheeeess",
        description: "棋譜を共有できるアプリ",
        targetCustomer: "",
        problem: "",
      },
    });

    const result = await draftProductFromUrl("example.com");
    expect(result.draft.targetCustomer).toBe("");
    expect(result.draft.problem).toBe("");
  });

  it("本文が取れずメタ情報のみの場合は、その旨をAIに伝える", async () => {
    mockFetchPageText.mockResolvedValue({ ...page, metadataOnly: true });
    mockParse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { name: "Cheeeess", description: "", targetCustomer: "", problem: "" },
    });

    await draftProductFromUrl("example.com");
    const prompt = mockParse.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toMatch(/メタ情報のみ/);
  });

  it("ページを取得できない場合はPageFetchErrorがそのまま伝わる", async () => {
    mockFetchPageText.mockRejectedValue(new PageFetchError("内部ホストのURLは取得できません"));

    await expect(draftProductFromUrl("http://localhost/")).rejects.toBeInstanceOf(PageFetchError);
    expect(mockParse).not.toHaveBeenCalled();
  });

  it("AIが拒否した場合は専用のエラーになる", async () => {
    mockParse.mockResolvedValue({
      stop_reason: "refusal",
      stop_details: { explanation: "不適切な内容" },
      parsed_output: null,
    });

    await expect(draftProductFromUrl("example.com")).rejects.toBeInstanceOf(DraftRefusedError);
  });

  it("応答を解析できない場合はエラーになる(空の下書きを保存させない)", async () => {
    mockParse.mockResolvedValue({ stop_reason: "end_turn", parsed_output: null });

    await expect(draftProductFromUrl("example.com")).rejects.toThrow(/解析できません/);
  });
});
