import { CheckCircle2, HelpCircle, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type EvidenceKind = "fact" | "hypothesis" | "unknown";

const config: Record<
  EvidenceKind,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  fact: {
    label: "事実",
    icon: CheckCircle2,
    className: "border-border bg-secondary text-secondary-foreground",
  },
  hypothesis: {
    label: "仮説",
    icon: HelpCircle,
    className: "border-dashed border-warning/50 bg-warning/10 text-warning-foreground",
  },
  unknown: {
    label: "不明",
    icon: MinusCircle,
    className: "border-dashed border-border bg-muted text-muted-foreground",
  },
};

/**
 * Fact(確認された事実)、Hypothesis(AI/ユーザーの仮説)、不明(判断材料が無い)を、
 * アプリ全体で常に同じ見た目で区別するためのバッジ。
 *
 * マスタープロンプトの必須要件(「AIの推測を事実として表示しない」「分からないことを
 * 埋めない」)をUI上で徹底するための共通プリミティブ。個別画面での自作を避け、必ずこれを使う。
 */
export function EvidenceBadge({
  kind,
  className,
}: {
  kind: EvidenceKind;
  className?: string;
}) {
  const { label, icon: Icon, className: variantClassName } = config[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium w-fit whitespace-nowrap",
        variantClassName,
        className
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}
