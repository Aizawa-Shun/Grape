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

export interface FetchedPage {
  url: string;
  title?: string;
  text: string;
  truncated: boolean;
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

/** HTMLから、AIに渡す意味のあるテキストだけを抽出する。 */
function extractText(html: string): { title?: string; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const description = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i
  )?.[1];
  const ogDescription = html.match(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i
  )?.[1];

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  const parts = [
    title ? `ページタイトル: ${title}` : undefined,
    description ? `メタ説明: ${description}` : undefined,
    ogDescription && ogDescription !== description ? `OG説明: ${ogDescription}` : undefined,
    body ? `本文: ${body}` : undefined,
  ].filter(Boolean);

  return { title, text: parts.join("\n\n") };
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
        "User-Agent": "GrapeBot/1.0 (+https://github.com/Aizawa-Shun/Grape)",
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
  const { title, text } = extractText(html);

  if (!text) {
    throw new PageFetchError("ページから文章を抽出できませんでした");
  }

  return {
    url: url.toString(),
    title,
    text: text.slice(0, MAX_CHARS),
    truncated: text.length > MAX_CHARS,
  };
}
