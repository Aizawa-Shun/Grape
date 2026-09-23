import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * 登録されたプロダクトURLから、AIに渡すためのテキストを取得する。
 *
 * 重要: このアプリは現時点で認証が無く公開されているため、URLは「信頼できない入力」として扱う。
 * 内部ネットワーク(クラウドのメタデータサーバ等)へサーバー経由でアクセスさせられる
 * SSRFを防ぐため、プロトコルと名前解決後のIPを検証する。
 */

const MAX_CHARS = 30_000;
const TIMEOUT_MS = 15_000;
const USER_AGENT = "GrapeBot/1.0 (+https://github.com/Aizawa-Shun/Grape)";

export interface FetchedPage {
  url: string;
  title?: string;
  text: string;
  truncated: boolean;
  /**
   * 本文が取れず、メタ情報(タイトル・説明・マニフェスト)しか得られなかったか。
   * JavaScriptで描画するSPA(Expo / React等)では、HTML自体に本文が含まれない。
   */
  metadataOnly: boolean;
}

export class PageFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageFetchError";
  }
}

function isBlockedIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    // ループバック / リンクローカル / ユニークローカル
    if (v6 === "::1" || v6 === "::" || v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd")) {
      return true;
    }
    // IPv4射影アドレス(::ffff:10.0.0.1 など)は v4 部分で判定する
    const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isBlockedIp(mapped[1]) : false;
  }

  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // プライベート
    a === 127 || // ループバック
    (a === 169 && b === 254) || // リンクローカル(クラウドのメタデータサーバ)
    (a === 172 && b >= 16 && b <= 31) || // プライベート
    (a === 192 && b === 168) || // プライベート
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224 // マルチキャスト/予約
  );
}

async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PageFetchError("URLの形式が正しくありません");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PageFetchError("http / https 以外のURLは取得できません");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new PageFetchError("内部ホストのURLは取得できません");
  }

  const address = isIP(host) ? host : (await lookup(host)).address;
  if (isBlockedIp(address)) {
    throw new PageFetchError("内部ネットワーク上のURLは取得できません");
  }

  return url;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

// 1回の置換で処理し、"&amp;lt;" のような二重デコードを防ぐ。
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function clean(value: string | undefined): string | undefined {
  const result = value ? decodeEntities(value).replace(/\s+/g, " ").trim() : "";
  return result || undefined;
}

/** `<meta a="1" b='2'>` の属性を、並び順に依存せず取り出す。 */
function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
  }
  return attrs;
}

/** name / property をキーにしたmetaタグの内容。 */
function parseMetaTags(html: string): Map<string, string> {
  const metas = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(tag);
    const key = (attrs.name ?? attrs.property)?.toLowerCase();
    const content = clean(attrs.content);
    if (key && content && !metas.has(key)) {
      metas.set(key, content);
    }
  }
  return metas;
}

function findManifestHref(html: string): string | undefined {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(tag);
    if (attrs.rel?.toLowerCase().split(/\s+/).includes("manifest") && attrs.href) {
      return attrs.href;
    }
  }
  return undefined;
}

function firstOf(...values: (string | undefined)[]): string | undefined {
  return values.find((v) => v);
}

interface ExtractedPage {
  title?: string;
  /** サイト名・説明などのメタ情報(ラベル付きの行)。 */
  metadata: string[];
  body: string;
  manifestHref?: string;
}

/** HTMLから、AIに渡す意味のあるテキストだけを抽出する。 */
function extractPage(html: string): ExtractedPage {
  const metas = parseMetaTags(html);
  const title = firstOf(
    clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]),
    metas.get("og:title"),
    metas.get("twitter:title")
  );
  const siteName = firstOf(
    metas.get("og:site_name"),
    metas.get("application-name"),
    metas.get("apple-mobile-web-app-title")
  );

  const descriptions = [
    ...new Set(
      [metas.get("description"), metas.get("og:description"), metas.get("twitter:description")]
        .filter((d): d is string => !!d)
    ),
  ];

  const metadata = [
    title ? `ページタイトル: ${title}` : undefined,
    siteName && siteName !== title ? `サイト名: ${siteName}` : undefined,
    ...descriptions.map((d) => `メタ説明: ${d}`),
  ].filter((line): line is string => !!line);

  // <head> を除かないと <title> の文字列が本文扱いになり、JS描画のページを判定できない。
  const body = decodeEntities(
    html
      .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
      .replace(/<title[\s\S]*?<\/title>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

  return { title: title ?? siteName, metadata, body, manifestHref: findManifestHref(html) };
}

/**
 * Web App Manifest からアプリ名と説明を読む。
 * JavaScriptで描画するアプリでも、ここには名前・説明が書かれていることが多い。
 * 補助情報なので、取得できなくてもエラーにはしない。
 */
async function fetchManifestLines(href: string, pageUrl: URL): Promise<string[]> {
  try {
    const url = await assertPublicUrl(new URL(href, pageUrl).toString());
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: "application/manifest+json,application/json" },
    });
    if (!response.ok) {
      return [];
    }
    const manifest: unknown = await response.json();
    if (typeof manifest !== "object" || manifest === null) {
      return [];
    }
    const field = (key: string) => {
      const value = (manifest as Record<string, unknown>)[key];
      return typeof value === "string" ? clean(value) : undefined;
    };
    const name = firstOf(field("name"), field("short_name"));
    const description = field("description");
    return [
      name ? `アプリ名(マニフェスト): ${name}` : undefined,
      description ? `アプリの説明(マニフェスト): ${description}` : undefined,
    ].filter((line): line is string => !!line);
  } catch {
    return [];
  }
}

/**
 * URLを取得してテキスト化する。
 * 取得できなかった場合は PageFetchError を投げる(呼び出し側で「取得できなかった」ことを
 * 明示的に扱い、内容を推測で埋めないため)。
 */
export async function fetchPageText(rawUrl: string): Promise<FetchedPage> {
  const url = await assertPublicUrl(rawUrl);

  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError"
      ? `${TIMEOUT_MS / 1000}秒以内に応答がありませんでした`
      : "ページに接続できませんでした";
    throw new PageFetchError(reason);
  }

  if (!response.ok) {
    throw new PageFetchError(`ページの取得に失敗しました (HTTP ${response.status})`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("html") && !contentType.includes("text/plain")) {
    throw new PageFetchError(`HTMLではないため解析できません (${contentType || "不明な形式"})`);
  }

  const html = await response.text();
  const page = extractPage(html);
  const metadataOnly = !page.body;

  const lines = [...page.metadata];
  if (metadataOnly && page.manifestHref) {
    const finalUrl = response.url ? new URL(response.url) : url;
    lines.push(...(await fetchManifestLines(page.manifestHref, finalUrl)));
  }
  if (page.body) {
    lines.push(`本文: ${page.body}`);
  }

  if (lines.length === 0) {
    throw new PageFetchError(
      "ページから文章を抽出できませんでした。JavaScriptで表示するページで、タイトルや説明文も設定されていない可能性があります"
    );
  }

  const text = lines.join("\n\n");
  return {
    url: url.toString(),
    title: page.title,
    text: text.slice(0, MAX_CHARS),
    truncated: text.length > MAX_CHARS,
    metadataOnly,
  };
}
