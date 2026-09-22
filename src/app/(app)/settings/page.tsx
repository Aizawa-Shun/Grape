import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { LlmSettingsForm } from "@/components/features/settings/llm-settings-form";
import { getLlmSettings } from "@/server/firebase/settings";

// 設定はDBの内容次第で変わるため、ビルド時に静的化せず常に動的にレンダリングする。
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getLlmSettings();

  return (
    <div>
      <PageHeader title="設定" description="Grapeが使用するLLMのAPIキーなどを設定します。" />

      <Card>
        <CardHeader>
          <CardTitle>LLM APIキー</CardTitle>
          <CardDescription>
            プロダクト分析・市場調査などのAI機能で使用するAnthropicのAPIキーです。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LlmSettingsForm hasApiKey={!!settings.anthropicApiKey} />
        </CardContent>
      </Card>
    </div>
  );
}
