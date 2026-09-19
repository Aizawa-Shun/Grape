# Implementation Roadmap — Grape

前提: `C:\Dev\Grape` は空。以下はマスタープロンプト §8 の各フェーズを、グリーンフィールドの
再構築として具体化したもの。各フェーズの開始前に現状確認、終了時にテスト・ビルド・UI確認・報告を行う
という進め方(マスタープロンプト§8, §11)は全フェーズ共通で厳守する。

## Phase 1 開始前: プロジェクト初期化(Bootstrap)

マスタープロンプトのPhase 1は「UI基盤」だが、その前提として空のディレクトリにプロジェクトを
立ち上げる作業が必要。これをPhase 1の最初のステップとして行う。

- [x] `git init` — **最優先**。今回のデータ消失の再発防止のため、初期化直後から頻繁にコミットする運用にする
- [x] `pnpm create next-app` 相当でNext.js(App Router, TypeScript, Tailwind, ESLint)を初期化
- [x] ~~Drizzle ORM + SQLite セットアップ~~ → **Firebase(Firestore + Admin SDK)に変更**(Phase 2着手後、
      利用者の指示により方針転換。経緯は[current-state.md §8](./current-state.md)参照)。
      `src/server/firebase/`, `firebase.json`, `firestore.rules`
- [x] Vitest + Testing Library セットアップ(Firestoreを伴うテストはエミュレータ上で実行)
- [ ] `.env.example` / `.gitignore` 整備
- [ ] `README.md` に起動手順を記載
- [ ] 初回コミット

## Phase 1: UI Foundation — ✅ 完了

- アプリケーションシェル(サイドナビ or トップナビ、レスポンシブ)
- デザイントークン(色・タイポグラフィ・spacing)をTailwind設定に反映
- 基礎コンポーネント: Button, Card, Badge, StatusPill, EmptyState, ErrorState, Skeleton/Loading
- Overview画面の**空状態**(まだProductが無い状態)のUIを先に作る(Phase 2以前なので実データが無い)
- モックデータはコンポーネント確認用途のみに限定し、`__mocks__` 等で実データと明確に分離。
  本番コードパスにモックを混在させない

**完了条件**: 全画面(Overview/Product/Market/Opportunities/Experiments/Execution/Results)の
空状態(まだ何も無い状態)が、同一のデザイン言語で表示できること。

## Phase 2: Product Onboarding — ✅ 完了(2026-09-19)

- [x] Product登録フォーム(URL, 概要, 想定顧客, 解決する課題)
- [x] Server Actionでの保存・バリデーション(Zod)
- [x] Firestore `products` コレクション
- [x] 一覧・詳細・編集画面
- [x] 完了条件(再読み込みでデータ保持、編集可、空状態、入力エラー表示)— E2Eで確認済み

**保留事項**: Firebase App Hostingへの実デプロイ。Blaze課金プランへのアップグレードが必須だが、
利用者の判断で今回は保留(Firestore/DBの完成を優先)。GitHubリポジトリとの連携も別途必要。
再開する際は `firebase apphosting:backends:create --non-interactive` から着手できる。

## Phase 3: Product Intelligence

- `product_facts` テーブル(recordType: fact/hypothesis, source, capturedAt)
- AIによるサービス理解(初回はURLから軽量スクレイピング+LLM要約、失敗時のフォールバック表示必須)
- Fact/Hypothesis/不明の3区分をUIで視覚的に区別

## Phase 4: Market Intelligence

- ターゲット顧客・顧客課題・競合・チャネルのデータモデルとCRUD
- 調査結果に情報源・取得日時を必須で紐付け
- 取得できなかった情報は「不明」として明示(埋めない)

## Phase 5: Growth Opportunities

- Opportunity一覧/詳細、Product+Marketの情報からAIが生成する初期ドラフト
- 根拠(evidence)とAI仮説の表示、ユーザーによる承認/却下

## Phase 6: Experiment Management

- Opportunity → Experiment 作成フロー
- 目的/仮説/対象/チャネル/成功指標/期間の入力
- ステータス管理(draft/pending_approval/active/completed/aborted)

## Phase 7: Content & Approval

- 最初の外部チャネルを1つに限定(**要決定**: 候補としてX(Twitter)手動投稿、またはブログ記事下書き等。
  API連携が無い場合はコピー&手動実行+実行記録のフローとする)
- コンテンツ案の作成・編集・承認状態・変更履歴

## Phase 8: Execution

- 承認済み施策の実行(手動実行が基本、Phase内でAPI連携有無を確認してから自動化範囲を決定)
- 実行状態(待機/実行中/成功/失敗/再試行)と履歴

## Phase 9: Measurement & Learning

- Outcome入力/取得、Experimentとの紐付け
- 計測できない指標は推測で埋めない(空欄+理由表示)
- 学びの記録と次のOpportunity候補への接続

## Phase 10: Overview統合

- 全機能をOverviewに集約(Growth Focus, 未確認Opportunity, 承認待ち, 進行中Experiment, 直近Outcome, 次のアクション)

---

## 依存関係の要点

- Phase 3(Product Intelligence)はPhase 2のデータ構造に依存
- Phase 5(Opportunities)はPhase 3・4の情報が無いと「根拠のある提案」にならないため、
  最低限のダミーでも良いので3・4を先に完了させる
- Phase 7(Content & Approval)着手前に、**外部チャネルを1つ選定する意思決定が必要**(利用者確認事項)

## 次のアクション

この3文書(current-state.md, architecture.md, implementation-roadmap.md)の内容について
利用者の確認を得た後、Phase 1(プロジェクト初期化 + UI Foundation)に着手する。
