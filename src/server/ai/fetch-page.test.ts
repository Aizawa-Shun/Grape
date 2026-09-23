import { afterEach, describe, expect, it, vi } from "vitest";
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

/**
 * 本文の抽出。fetch をスタブし、DNS解決が不要な公開IPのURLを使うことで
 * ネットワークアクセスなしで検証する。
 */
describe("fetchPageText の本文抽出", () => {
  const PAGE_URL = "http://93.184.216.34/";

  function stubFetch(routes: Record<string, { body: string; contentType: string }>) {
    const fetchMock = vi.fn(async (input: URL | string) => {
      const route = routes[input.toString()];
      if (!route) {
        return new Response("not found", { status: 404 });
      }
      return new Response(route.body, { headers: { "content-type": route.contentType } });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("通常のHTMLは本文とメタ情報を抽出する", async () => {
    const fetchMock = stubFetch({
      [PAGE_URL]: {
        contentType: "text/html; charset=utf-8",
        body: `<html><head><title>Foo &amp; Bar</title>
          <meta content="説明文" name="description">
          <link rel="manifest" href="/manifest.json"></head>
          <body><h1>ようこそ</h1><script>var x = 1;</script></body></html>`,
      },
    });

    const page = await fetchPageText(PAGE_URL);
    expect(page.title).toBe("Foo & Bar");
    expect(page.text).toContain("メタ説明: 説明文");
    expect(page.text).toContain("本文: ようこそ");
    expect(page.text).not.toContain("var x");
    expect(page.metadataOnly).toBe(false);
    // 本文が取れている場合はマニフェストまで取りに行かない
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("JavaScriptで描画するページ(本文・titleが空)はメタ情報とマニフェストから読み取る", async () => {
    stubFetch({
      [PAGE_URL]: {
        contentType: "text/html; charset=utf-8",
        body: `<!DOCTYPE html><html lang="ja"><head><title data-rh="true"></title>
          <meta name="apple-mobile-web-app-title" content="Cheeeess"/>
          <link rel="manifest" href="/manifest.json"/></head>
          <body><div id="root"><div class="css-g5y9jx"><!--$--><div></div><!--/$--></div></div>
          <script src="/_expo/static/js/web/entry.js" defer></script></body></html>`,
      },
      [`${PAGE_URL}manifest.json`]: {
        contentType: "application/json",
        body: JSON.stringify({ name: "Cheeeess", description: "オンラインチェスアプリ" }),
      },
    });

    const page = await fetchPageText(PAGE_URL);
    expect(page.metadataOnly).toBe(true);
    expect(page.title).toBe("Cheeeess");
    expect(page.text).toContain("サイト名: Cheeeess");
    expect(page.text).toContain("アプリの説明(マニフェスト): オンラインチェスアプリ");
  });

  it("titleがあっても本文が空ならJS描画のページとして扱い、マニフェストを読む", async () => {
    stubFetch({
      [PAGE_URL]: {
        contentType: "text/html",
        body: `<html><head><title>My App</title><link rel="manifest" href="app.webmanifest"></head><body><div id="root"></div></body></html>`,
      },
      [`${PAGE_URL}app.webmanifest`]: {
        contentType: "application/manifest+json",
        body: JSON.stringify({ short_name: "MyApp", description: "家計簿アプリ" }),
      },
    });

    const page = await fetchPageText(PAGE_URL);
    expect(page.metadataOnly).toBe(true);
    expect(page.text).not.toContain("本文:");
    expect(page.text).toContain("アプリの説明(マニフェスト): 家計簿アプリ");
  });

  it("マニフェストの取得に失敗してもメタ情報があれば成功する", async () => {
    stubFetch({
      [PAGE_URL]: {
        contentType: "text/html",
        body: `<html><head><meta property="og:title" content="App"><link rel="manifest" href="/missing.json"></head><body><div id="root"></div></body></html>`,
      },
    });

    const page = await fetchPageText(PAGE_URL);
    expect(page.metadataOnly).toBe(true);
    expect(page.text).toBe("ページタイトル: App");
  });

  it("本文もメタ情報も無い場合はPageFetchErrorになる", async () => {
    stubFetch({
      [PAGE_URL]: {
        contentType: "text/html",
        body: `<html><head><title></title></head><body><div id="root"></div></body></html>`,
      },
    });

    await expect(fetchPageText(PAGE_URL)).rejects.toThrow(/文章を抽出できませんでした/);
  });
});
