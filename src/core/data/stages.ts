import type { FunnelStage } from "@/db/schema";

/**
 * How the five stages are named to a person.
 *
 * The audience is a developer who has never done marketing, so the labels are
 * plain Japanese verbs describing what the visitor did, not funnel vocabulary.
 * "Engage" tells that reader nothing; "中身を見てもらう" tells them exactly
 * what is being counted.
 *
 * One definition, because the same table had been copied into three UI files
 * and had already started to disagree between them.
 */
export interface StageCopy {
  /** Used as a heading or a badge. */
  label: string;
  /** One line explaining what is counted, shown next to the label. */
  help: string;
  /** Reads as "…が increased" in a sentence about a measured change. */
  noun: string;
}

export const STAGE_UI: Record<FunnelStage, StageCopy> = {
  reach: {
    label: "見つけてもらう",
    help: "そもそもサイトに人が来ているか",
    noun: "サイトに来た人",
  },
  visit: {
    label: "来てもらう",
    help: "サイトを開いた人の数",
    noun: "サイトを開いた人",
  },
  engage: {
    label: "中身を見てもらう",
    help: "開いてすぐ帰らずに、中身を見た人",
    noun: "中身を見た人",
  },
  activate: {
    label: "使ってもらう",
    help: "登録など、あなたが決めた「ゴールの操作」をした人",
    noun: "ゴールまで進んだ人",
  },
  retain: {
    label: "また来てもらう",
    help: "7日以内にもう一度来た人",
    noun: "もう一度来た人",
  },
};

export function stageLabel(stage: FunnelStage): string {
  return STAGE_UI[stage].label;
}
