"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import {
  insightCategories,
  insightCategoryLabels,
  type InsightCategory,
} from "@/lib/validation/market-insight";
import { recordTypes, type RecordType } from "@/lib/validation/product-fact";
import {
  initialInsightActionState,
  type InsightActionState,
} from "@/server/actions/market-insight-types";

const recordTypeLabels: Record<RecordType, string> = {
  fact: "事実(情報源で確認できた)",
  hypothesis: "仮説(まだ確認していない)",
  unknown: "不明(調べたが分からなかった)",
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {label}
    </Button>
  );
}

export function InsightForm({
  action,
  defaultValues,
  submitLabel,
  onCancel,
  onSuccess,
}: {
  action: (state: InsightActionState, formData: FormData) => Promise<InsightActionState>;
  defaultValues?: {
    category: InsightCategory;
    content: string;
    recordType: RecordType;
    sourceUrl?: string;
  };
  submitLabel: string;
  onCancel?: () => void;
  onSuccess?: () => void;
}) {
  const [state, formAction] = useActionState(action, initialInsightActionState);

  useEffect(() => {
    if (state.status === "success") {
      onSuccess?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.status === "error" && state.message && !state.errors ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="カテゴリ" htmlFor="category" required error={state.errors?.category?.[0]}>
          <Select
            id="category"
            name="category"
            defaultValue={defaultValues?.category ?? "targetCustomer"}
          >
            {insightCategories.map((category) => (
              <option key={category} value={category}>
                {insightCategoryLabels[category]}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="種別" htmlFor="recordType" required error={state.errors?.recordType?.[0]}>
          <Select
            id="recordType"
            name="recordType"
            defaultValue={defaultValues?.recordType ?? "fact"}
          >
            {recordTypes.map((type) => (
              <option key={type} value={type}>
                {recordTypeLabels[type]}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <FormField label="内容" htmlFor="content" required error={state.errors?.content?.[0]}>
        <Textarea
          id="content"
          name="content"
          rows={3}
          defaultValue={defaultValues?.content}
          placeholder="例: 初心者向けチェス学習者はRedditのr/chessbeginnersに集まっている"
          aria-invalid={!!state.errors?.content}
        />
      </FormField>

      <FormField
        label="情報源URL"
        htmlFor="sourceUrl"
        error={state.errors?.sourceUrl?.[0]}
        hint="確認したページがあれば入力してください(任意)"
      >
        <Input
          id="sourceUrl"
          name="sourceUrl"
          defaultValue={defaultValues?.sourceUrl}
          placeholder="https://example.com/..."
          aria-invalid={!!state.errors?.sourceUrl}
        />
      </FormField>

      <div className="flex items-center gap-2">
        <SubmitButton label={submitLabel} />
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            キャンセル
          </Button>
        ) : null}
      </div>
    </form>
  );
}
