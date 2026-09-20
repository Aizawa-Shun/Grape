"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import {
  factCategories,
  factCategoryLabels,
  recordTypes,
  type FactCategory,
  type RecordType,
} from "@/lib/validation/product-fact";
import {
  initialFactActionState,
  type FactActionState,
} from "@/server/actions/product-fact-types";

const recordTypeLabels: Record<RecordType, string> = {
  fact: "事実(確認済みの情報)",
  hypothesis: "仮説(まだ確認していない推測)",
  unknown: "不明(判断材料が無い)",
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {label}
    </Button>
  );
}

export function FactForm({
  action,
  defaultValues,
  submitLabel,
  onCancel,
  onSuccess,
}: {
  action: (state: FactActionState, formData: FormData) => Promise<FactActionState>;
  defaultValues?: { category: FactCategory; content: string; recordType: RecordType };
  submitLabel: string;
  onCancel?: () => void;
  onSuccess?: () => void;
}) {
  const [state, formAction] = useActionState(action, initialFactActionState);

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
          <Select id="category" name="category" defaultValue={defaultValues?.category ?? "problem"}>
            {factCategories.map((category) => (
              <option key={category} value={category}>
                {factCategoryLabels[category]}
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
          placeholder="例: チェス初心者が棋譜を振り返る手段を持っていない"
          aria-invalid={!!state.errors?.content}
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
