import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "@/server/firebase/test-utils";
import { getLlmSettings, saveLlmSettings } from "./settings";

describe("settings queries (Firestore)", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  it("初期状態ではAPIキーが未設定", async () => {
    expect(await getLlmSettings(db)).toEqual({});
  });

  it("APIキーを保存すると取得できる", async () => {
    await saveLlmSettings({ anthropicApiKey: "sk-ant-test" }, db);
    const settings = await getLlmSettings(db);
    expect(settings.anthropicApiKey).toBe("sk-ant-test");
    expect(settings.updatedAt).toBeInstanceOf(Date);
  });

  it("空文字で保存すると削除される", async () => {
    await saveLlmSettings({ anthropicApiKey: "sk-ant-test" }, db);
    await saveLlmSettings({ anthropicApiKey: "" }, db);
    const settings = await getLlmSettings(db);
    expect(settings.anthropicApiKey).toBeUndefined();
  });
});
