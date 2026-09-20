import { describe, expect, it } from "vitest";
import { fetchPageText, PageFetchError } from "./fetch-page";

/**
 * このアプリは認証なしで公開されているため、登録URLは信頼できない入力として扱う。
 * サーバー経由で内部ネットワークへアクセスさせられること(SSRF)を防げているかを検証する。
 * ここで検証している経路はいずれもネットワークアクセス前に弾かれる。
 */
describe("fetchPageText のURL検証", () => {
  it("http / https 以外のプロトコルを拒否する", async () => {
    await expect(fetchPageText("ftp://example.com/x")).rejects.toThrow(PageFetchError);
    await expect(fetchPageText("file:///etc/passwd")).rejects.toThrow(PageFetchError);
  });

  it("localhost を拒否する", async () => {
    await expect(fetchPageText("http://localhost/")).rejects.toThrow(/内部ホスト/);
    await expect(fetchPageText("http://app.localhost/")).rejects.toThrow(/内部ホスト/);
  });

  it("ループバックIPを拒否する", async () => {
    await expect(fetchPageText("http://127.0.0.1/")).rejects.toThrow(/内部ネットワーク/);
    await expect(fetchPageText("http://[::1]/")).rejects.toThrow(/内部ネットワーク/);
  });

  it("クラウドのメタデータサーバ(リンクローカル)を拒否する", async () => {
    await expect(fetchPageText("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /内部ネットワーク/
    );
  });

  it("プライベートIP帯を拒否する", async () => {
    await expect(fetchPageText("http://10.0.0.5/")).rejects.toThrow(/内部ネットワーク/);
    await expect(fetchPageText("http://192.168.1.1/")).rejects.toThrow(/内部ネットワーク/);
    await expect(fetchPageText("http://172.16.0.1/")).rejects.toThrow(/内部ネットワーク/);
  });

  it("URLとして壊れている場合は明示的に失敗する", async () => {
    await expect(fetchPageText("not-a-url")).rejects.toThrow(/URLの形式/);
  });
});
