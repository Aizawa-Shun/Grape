import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * 取得・保存・AI呼び出しなどが失敗した状態を明示するための共通コンポーネント。
 * エラーを無視して空欄やダミー値で埋めない(マスタープロンプトの必須要件)。
 */
export function ErrorState({
  title = "うまく読み込めませんでした",
  description,
  onRetry,
  className,
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-12 text-center",
        className
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-destructive/15">
        <AlertTriangle className="size-5 text-destructive" aria-hidden />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          再試行
        </Button>
      ) : null}
    </div>
  );
}
