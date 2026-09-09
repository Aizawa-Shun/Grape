import { ERROR_CODES, type AppError, type ErrorCode } from "@/core/errors";

/**
 * The only place in this codebase that writes to the person using it about a
 * failure.
 *
 * Two rules, and they are the reason this file exists rather than the text
 * living at each throw site:
 *
 * 1. Every entry says what happened *and* what to do about it. The reader is a
 *    developer who has never done marketing and is not going to debug Grape —
 *    "AIの回答が壊れました" alone leaves them stuck.
 * 2. Nothing here interpolates `error.message`. That is what makes it
 *    structurally impossible for raw model output or a driver error to reach
 *    the browser, which is what was happening before.
 */

interface Entry {
  status: number;
  text: string;
}

const CATALOG: Record<ErrorCode, Entry> = {
  INVALID_INPUT: {
    status: 400,
    text: "入力された内容が正しくありません。もう一度確認して入力しなおしてください。",
  },
  NOT_FOUND: {
    status: 404,
    text: "対象が見つかりませんでした。すでに削除されている可能性があります。ダッシュボードから開きなおしてください。",
  },
  CONFLICT: {
    status: 409,
    text: "この操作はすでに実行済みです。画面を再読み込みして、いまの状態を確認してください。",
  },
  TOO_EARLY: {
    status: 409,
    text: "効果を測るにはまだ早すぎます。実施したあとのデータがたまるまで待ってから、もう一度測定してください。",
  },
  NOT_ENOUGH_DATA: {
    status: 409,
    text: "判断できるだけの訪問がまだ集まっていません。先にサイトへの導線を作って、人が来るのを待ってください。",
  },
  RATE_LIMITED: {
    status: 429,
    text: "短い時間にリクエストが多すぎます。少し待ってから、もう一度試してください。",
  },
  UNAUTHORIZED: {
    status: 401,
    text: "ログインが必要です。メールアドレスとパスワードを入力してください。",
  },

  CRAWL_UNREACHABLE: {
    status: 502,
    text: "サイトを読み込めませんでした。URLが合っているか、サイトが公開されているかを確認してください。",
  },
  CRAWL_EMPTY: {
    status: 502,
    text: "サイトは開けましたが、読み取れる文章がありませんでした。トップページに、何のサービスかを説明する文章があるか確認してください。",
  },
  CRAWL_BLOCKED_TARGET: {
    status: 400,
    text: "このURLは読み込めません。インターネットから見えるアドレスか、あなた自身の開発用サーバーを指定してください。",
  },

  LLM_UNREACHABLE: {
    status: 503,
    text: "AIに接続できませんでした。手元のモデルを使っている場合は、Ollama が起動しているか確認してください。",
  },
  LLM_TIMEOUT: {
    status: 504,
    text: "AIの返事が時間内に返ってきませんでした。もっと軽いモデルに変えるか、時間をおいてもう一度試してください。",
  },
  LLM_AUTH: {
    status: 500,
    text: "AIの認証に失敗しました。.env のAPIキーが正しいか確認してください。",
  },
  LLM_RATE_LIMITED: {
    status: 429,
    text: "AIの利用上限に達しました。少し待ってから、もう一度試してください。",
  },
  LLM_BAD_OUTPUT: {
    status: 502,
    text: "AIの返事が途中で壊れていて、読み取れませんでした。もう一度実行してください。何度も続くときは、もう少し大きいモデルに変えてください。",
  },
  LLM_REFUSED: {
    status: 502,
    text: "AIがこの内容の作成を断りました。書かせたい内容を変えて、もう一度試してください。",
  },
  LLM_BUDGET_EXCEEDED: {
    status: 402,
    text: "今月のAI利用の上限額に達しました。設定画面で上限額を確認するか、来月まで待ってください。",
  },

  CHANNEL_AUTH: {
    status: 500,
    text: "送信先の設定が足りません。.env に必要なキーを設定してから、もう一度承認してください。",
  },
  CHANNEL_FAILED: {
    status: 502,
    text: "送信先が受け付けてくれませんでした。本文を作りなおして、もう一度承認してください。",
  },

  DB_ERROR: {
    status: 500,
    text: "データの保存に失敗しました。時間をおいて、もう一度試してください。",
  },
  INTERNAL: {
    status: 500,
    text: "予期しない問題が起きました。もう一度試して、それでも直らないときはサーバーのログを確認してください。",
  },
};

export function statusOf(error: AppError): number {
  return CATALOG[error.code].status;
}

/** Catalog sentence, plus the safe fragment the throw site supplied, if any. */
export function describeForUser(error: AppError): string {
  const { text } = CATALOG[error.code];
  return error.hint ? `${text}（${error.hint}）` : text;
}

/** Exported for the test that asserts the catalog stays complete. */
export const CATALOGUED_CODES = ERROR_CODES;
export const catalogEntry = (code: ErrorCode): Entry => CATALOG[code];
