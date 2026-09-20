import Anthropic from "@anthropic-ai/sdk";

/**
 * LLMプロバイダの抽象化層。
 *
 * APIキーはサーバーサイドのみで扱い、クライアントへ露出させない。
 * 将来プロバイダを差し替える場合も、呼び出し側はこのモジュール経由に限定する。
 */

export const AI_MODEL = "claude-opus-5";

/** APIキー未設定。UIに「設定してください」と明示するために他のエラーと区別する。 */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY が設定されていません。console.anthropic.com で発行したAPIキーを " +
        ".env.local(本番はApp Hostingの環境変数)に設定してください。"
    );
    this.name = "MissingApiKeyError";
  }
}

export function getAnthropicClient(): Anthropic {
  const provider = process.env.LLM_PROVIDER ?? "anthropic";
  if (provider !== "anthropic") {
    throw new Error(`未対応のLLM_PROVIDERです: ${provider}`);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new MissingApiKeyError();
  }

  return new Anthropic({ apiKey });
}

/** APIエラーを、UIにそのまま出せる日本語メッセージへ変換する。 */
export function describeAiError(error: unknown): string {
  if (error instanceof MissingApiKeyError) {
    return error.message;
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return (
      "APIキーが無効です。console.anthropic.com で発行したキーか確認してください。" +
      "(シェルに ANTHROPIC_API_KEY が設定されている場合、.env.local の値より優先されます。" +
      "Claude Code等の内部トークンは公開APIでは使えません)"
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "APIのレート制限に達しました。しばらく待ってから再試行してください。";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `APIへのリクエストが拒否されました: ${error.message}`;
  }
  if (error instanceof Anthropic.APIError) {
    return `AIの呼び出しに失敗しました (HTTP ${error.status}): ${error.message}`;
  }
  return error instanceof Error ? error.message : "AIの呼び出しに失敗しました";
}
