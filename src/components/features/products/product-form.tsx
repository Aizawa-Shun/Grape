"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import {
  initialProductActionState,
  type ProductActionState,
} from "@/server/actions/product-types";
import type { Product } from "@/server/firebase/products";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {label}
    </Button>
  );
}

export function ProductForm({
  action,
  product,
  submitLabel,
  onCancel,
  onSuccess,
}: {
  action: (
    state: ProductActionState,
    formData: FormData
  ) => Promise<ProductActionState>;
  product?: Product;
  submitLabel: string;
  onCancel?: () => void;
  onSuccess?: (state: ProductActionState) => void;
}) {
  const [state, formAction] = useActionState(action, initialProductActionState);

  useEffect(() => {
    if (state.status === "success" && onSuccess) {
      onSuccess(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.status === "error" && state.message && !state.errors ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <FormField label="プロダクト名" htmlFor="name" required error={state.errors?.name?.[0]}>
        <Input
          id="name"
          name="name"
          defaultValue={product?.name}
          placeholder="例: Cheeeess"
          aria-invalid={!!state.errors?.name}
          aria-describedby={state.errors?.name ? "name-error" : undefined}
        />
      </FormField>

      <FormField
        label="URL"
        htmlFor="url"
        required
        error={state.errors?.url?.[0]}
        hint="https:// が無い場合は自動で補います"
      >
        <Input
          id="url"
          name="url"
          defaultValue={product?.url}
          placeholder="https://example.com"
          aria-invalid={!!state.errors?.url}
          aria-describedby={state.errors?.url ? "url-error" : undefined}
        />
      </FormField>

      <FormField
        label="サービス概要"
        htmlFor="description"
        required
        error={state.errors?.description?.[0]}
        hint="どんなサービスか、簡潔に説明してください"
      >
        <Textarea
          id="description"
          name="description"
          defaultValue={product?.description}
          placeholder="例: チェスの棋譜を記録・共有できるWebアプリ"
          aria-invalid={!!state.errors?.description}
          aria-describedby={state.errors?.description ? "description-error" : undefined}
        />
      </FormField>

      <FormField
        label="想定顧客"
        htmlFor="targetCustomer"
        required
        error={state.errors?.targetCustomer?.[0]}
        hint="誰に使ってほしいサービスですか"
      >
        <Textarea
          id="targetCustomer"
          name="targetCustomer"
          defaultValue={product?.targetCustomer}
          placeholder="例: チェスを学び始めた初心者"
          aria-invalid={!!state.errors?.targetCustomer}
          aria-describedby={state.errors?.targetCustomer ? "targetCustomer-error" : undefined}
        />
      </FormField>

      <FormField
        label="解決する課題"
        htmlFor="problem"
        required
        error={state.errors?.problem?.[0]}
        hint="そのサービスが解決する課題は何ですか"
      >
        <Textarea
          id="problem"
          name="problem"
          defaultValue={product?.problem}
          placeholder="例: 棋譜を人に見せて相談する手段が無い"
          aria-invalid={!!state.errors?.problem}
          aria-describedby={state.errors?.problem ? "problem-error" : undefined}
        />
      </FormField>

      <div className="flex items-center gap-2 pt-1">
        <SubmitButton label={submitLabel} />
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            キャンセル
          </Button>
        ) : null}
      </div>
    </form>
  );
}
