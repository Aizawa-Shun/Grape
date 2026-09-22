"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import { saveLlmApiKey } from "@/server/actions/settings";
import { initialSettingsActionState } from "@/server/actions/settings-types";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      保存
    </Button>
  );
}

/** APIキーは保存済みかどうかだけをサーバーから受け取り、値自体は画面に出さない。 */
export function LlmSettingsForm({ hasApiKey }: { hasApiKey: boolean }) {
  const [state, formAction] = useActionState(saveLlmApiKey, initialSettingsActionState);
  // 保存成功のたびにkeyを変えて入力欄を再マウントし、保存済みの値を残さず空に戻す。
  const [formKey, setFormKey] = useState(0);
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.status === "success") {
      setFormKey((key) => key + 1);
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">現在の状態:</span>
        {hasApiKey ? (
          <Badge variant="success">設定済み</Badge>
        ) : (
          <Badge variant="warning">未設定</Badge>
        )}
      </div>

      {state.status === "error" && state.message ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" && state.message ? (
        <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          {state.message}
        </p>
      ) : null}

      <FormField
        label="Anthropic APIキー"
        htmlFor="anthropicApiKey"
        hint={
          hasApiKey
            ? "変更する場合のみ新しいキーを入力してください。空欄のまま保存すると削除されます。"
            : "console.anthropic.com で発行したAPIキーを入力してください。"
        }
      >
        <Input
          key={formKey}
          id="anthropicApiKey"
          name="anthropicApiKey"
          type="password"
          autoComplete="off"
          defaultValue=""
          placeholder={hasApiKey ? "••••••••••••••••" : "sk-ant-..."}
        />
      </FormField>

      <div className="flex items-center gap-2 pt-1">
        <SaveButton />
      </div>
    </form>
  );
}
