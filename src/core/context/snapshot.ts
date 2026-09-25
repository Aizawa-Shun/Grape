import type { Product, ProductContext } from "@/db/schema";

/**
 * Renders the Product Context into the stable prefix every downstream prompt
 * shares.
 *
 * This function has one hard rule: **its output must depend only on the stored
 * product and context rows.** No `new Date()`, no run ids, no metric values, no
 * key ordering that varies between calls.
 *
 * That is not tidiness. Providers cache on an exact prefix match, so a single
 * varying byte in here turns every re-diagnosis into a full-price call and
 * silently multiplies the cost of the weekly loop. `snapshot.test.ts` enforces
 * the rule; `usage.cacheReadInputTokens` on the second call confirms it in
 * production.
 */
export function renderContextSnapshot(product: Product, context: ProductContext): string {
  const lines = [
    "# 対象プロダクト",
    "",
    `名前: ${product.name}`,
    `URL: ${product.url}`,
    `アクティベーションイベント: ${product.keyEventName ?? "(未設定)"}`,
    "",
    `# Product Context (v${context.version})`,
    "",
    "## What — 何をするものか",
    context.what,
    "",
    "## Who — 誰のためのものか",
    context.who,
    "",
    "## Why — どんな課題を解くのか",
    context.why,
    "",
    "## How — どう動くのか",
    context.how,
    "",
    "## 根拠にしたページ",
    ...[...context.sourcePages].sort().map((url) => `- ${url}`),
  ];

  // A human-corrected context is more trustworthy than an extracted one, and
  // downstream reasoning should know which it is holding.
  lines.push(
    "",
    context.editedByHuman
      ? "注記: このContextは人間が確認・修正済みです。記述を信頼してよい。"
      : "注記: このContextはサイトからの自動抽出のみで、人間の確認を経ていません。" +
          "断定的な記述でも誤っている可能性を織り込むこと。",
  );

  return lines.join("\n");
}
