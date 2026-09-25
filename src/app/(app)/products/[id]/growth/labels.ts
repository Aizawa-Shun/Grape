import type { OpportunitySource, PostType } from "@/db/schema";

/** How each growth enum reads on screen. Kept apart from components so server and client pages share one wording. */

export const POST_TYPE_LABELS: Record<PostType, string> = {
  educational: "学び・ノウハウ",
  problem_awareness: "問題提起",
  product_demo: "デモ",
  feature: "機能紹介",
  before_after: "ビフォーアフター",
  case_study: "事例",
  founder_story: "作り手の話",
  build_in_public: "開発の裏側",
  question: "問いかけ",
  contrarian: "逆張りの意見",
  comparison: "比較",
  tutorial: "チュートリアル",
  launch: "ローンチ",
  product_update: "アップデート",
};

export const SOURCE_LABELS: Record<OpportunitySource, string> = {
  x: "X",
  hackernews: "Hacker News",
  web: "Web",
  manual: "あなたが追加",
};

export const INTENT_LABELS = {
  seeking_solution: "解決策を探している",
  complaint: "不満を言っている",
  question: "質問している",
  discussion: "話題にしている",
} as const;

export const ACTION_LABELS = {
  reply: "返信する",
  content: "投稿のネタにする",
  watch: "様子を見る",
} as const;

export const INSIGHT_LABELS = {
  pain: "悩み",
  phrase: "よく使われる言い方",
  complaint: "既存手段への不満",
  desired_feature: "求められている機能",
  unmet_need: "満たされていないニーズ",
  trend: "話題のテーマ",
  gap: "まだ誰も訴求していない領域",
  competitor_move: "競合の動き",
} as const;
