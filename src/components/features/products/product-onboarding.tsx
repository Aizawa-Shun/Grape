"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, ArrowLeft, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { ProductForm } from "@/components/features/products/product-form";
import { createProduct, draftProduct } from "@/server/actions/products";
import {
  initialDraftActionState,
  type DraftActionState,
} from "@/server/actions/product-draft-types";
import type { ProductDraft } from "@/server/ai/product-draft";

function AnalyzeButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {!pending ? <Wand2 className="size-4" aria-hidden /> : null}
      {pending ? "読み取っています…" : "URLから読み取る"}
    </Button>
  );
}

function AnalyzePendingNote() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <p className="text-sm text-muted-foreground">
      ページを読み込んでAIが内容を整理しています。20秒ほどかかることがあります。
    </p>
  );
}

const emptyFieldLabels: Record<keyof ProductDraft, string> = {
  name: "プロダクト名",
  description: "サービス概要",
  targetCustomer: "想定顧客",
  problem: "解決する課題",
};

/**
 * プロダクト登録のオンボーディング。
 *
 * 入力の手間を減らすため、まずURLだけを受け取ってAIに下書きを作らせ、
 * 利用者は違うところだけ直して登録する。
 *
 * AIが読み取った内容は「確認してもらう前提の下書き」であって確定情報ではないため、
 * 確認を促す文言を必ず表示し、読み取れなかった項目は空欄のまま提示する。
 */
export function ProductOnboarding() {
  const [draftState, draftAction] = useActionState<DraftActionState, FormData>(
    draftProduct,
    initialDraftActionState
  );
  const [manualMode, setManualMode] = useState(false);
  // Reactはアクション完了後に非制御フォームをリセットするため、制御コンポーネントにして
  // 読み取り失敗時に入力済みのURLを保持する(入力し直しをさせない)。
  const [url, setUrl] = useState("");
  // 下書き生成後に「URLの入力に戻る」を押した状態。useActionStateは外から
  // リセットできないため、表示側で無効化する。
  const [dismissedDraft, setDismissedDraft] = useState(false);

  const draft =
    draftState.status === "success" && !dismissedDraft ? draftState.draft : undefined;
  const showForm = manualMode || !!draft;

  if (!showForm) {
    return (
      <div className="flex max-w-xl flex-col gap-5">
        <form
          action={draftAction}
          onSubmit={() => setDismissedDraft(false)}
          className="flex flex-col gap-4"
        >
          <FormField
            label="サービスのURL"
            htmlFor="url"
            required
            hint="このURLをAIが読み取り、残りの項目を下書きします"
          >
            <Input
              id="url"
              name="url"
              placeholder="https://example.com"
              autoFocus
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              aria-invalid={draftState.status === "error"}
            />
          </FormField>

          {draftState.status === "error" ? (
            <div
              role="alert"
              className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"
            >
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
              <div>
                <p className="font-medium text-destructive">URLから読み取れませんでした</p>
                <p className="mt-1 text-destructive/90">{draftState.message}</p>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col items-start gap-2">
            <AnalyzeButton />
            <AnalyzePendingNote />
          </div>
        </form>

        <div className="border-t border-border pt-4">
          <Button variant="ghost" size="sm" onClick={() => setManualMode(true)}>
            AIを使わず自分で入力する
          </Button>
        </div>
      </div>
    );
  }

  const emptyFields = draft
    ? (Object.keys(emptyFieldLabels) as (keyof ProductDraft)[]).filter((key) => !draft[key])
    : [];

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {draft ? (
        <div className="flex gap-3 rounded-lg border border-border bg-secondary/40 p-4 text-sm">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="font-medium text-foreground">AIがページを読み取って下書きしました</p>
            <p className="mt-1 text-muted-foreground">
              内容を確認し、違うところだけ直してください。ここで保存した内容が、
              Grapeがあなたのサービスを理解する土台になります。
            </p>
            {emptyFields.length > 0 ? (
              <p className="mt-2 text-muted-foreground">
                ページから読み取れなかったため空欄にしている項目:{" "}
                <span className="text-foreground">
                  {emptyFields.map((key) => emptyFieldLabels[key]).join("、")}
                </span>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <ProductForm
        action={createProduct}
        // 手動入力に切り替えた場合も、入力済みのURLは引き継ぐ。
        product={draft ? { ...draft, url: draftState.url } : url ? { url } : undefined}
        submitLabel="登録する"
      />

      <div className="border-t border-border pt-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setManualMode(false);
            setDismissedDraft(true);
          }}
        >
          <ArrowLeft className="size-4" aria-hidden />
          URLの入力に戻る
        </Button>
      </div>
    </div>
  );
}
