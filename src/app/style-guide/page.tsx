"use client";

import { CheckCircle2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EvidenceBadge } from "@/components/ui/evidence-badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

/**
 * 社内確認用: デザインシステムのプレビューページ。
 *
 * 製品のナビゲーションには含まれない(実際のユーザー導線ではない)。
 * ここに表示される内容はすべてUI確認用のサンプルであり、実データではない。
 */
export default function StyleGuidePage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">デザインシステム プレビュー</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          社内確認用ページです。以下はすべてサンプル表示であり、実データではありません。
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Buttons</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <Button loading>読み込み中</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="確認">
            <CheckCircle2 />
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Badges</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="success">承認済み</Badge>
          <Badge variant="warning">承認待ち</Badge>
          <Badge variant="destructive">失敗</Badge>
          <Badge variant="info">実行中</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EvidenceBadge kind="fact" />
          <EvidenceBadge kind="hypothesis" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Card</h2>
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>サンプルカード</CardTitle>
            <CardDescription>説明文がここに入ります。</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">本文コンテンツ。</CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Empty state</h2>
        <EmptyState
          icon={Package}
          title="サンプルの空状態"
          description="データが無い場合の表示サンプルです。"
          action={<Button size="sm">アクション</Button>}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Error state</h2>
        <ErrorState description="サンプルのエラー表示です。" onRetry={() => {}} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Loading</h2>
        <div className="flex items-center gap-3">
          <Spinner />
          <span className="text-sm text-muted-foreground">読み込み中…</span>
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-20 w-full max-w-sm" />
        </div>
      </section>
    </div>
  );
}
