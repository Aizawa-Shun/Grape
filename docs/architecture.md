# Architecture — Grape (再構築版)

既存コードが存在しないため、これはグリーンフィールドの設計提案である。
マスタープロンプト(§3, §6, §7)の要件を満たすことを目的に、実装前に確定させたい事項をまとめる。
**この文書はPhase 1着手前の提案であり、重要な選択については報告時に利用者の確認を仰ぐ。**

## 1. プロダクトの核(再掲・要約)

Understand → Discover → Execute → Measure → Learn の成長ループを中心に、
Product / Market の理解から Opportunity を発見し、Experiment として実行し、
Outcome から学ぶ、という一連のフローをアプリとして成立させる。

全データは **Fact(確認された事実) / Hypothesis(仮説) / Action(実行する施策) / Outcome(実行結果)**
のいずれかに明確に分類され、UI上でも区別して表示される。

## 2. 技術スタック(提案)

| 領域 | 選定 | 理由 |
|---|---|---|
| フレームワーク | Next.js (App Router) + React + TypeScript | マスタープロンプト7章の想定と一致。Server ActionsでAPI層を薄くできる |
| パッケージマネージャ | pnpm | 過去プロジェクトでも採用。ディスク効率・速度が良い |
| DB | SQLite (ファイルDB) | マスタープロンプト7章の想定。個人開発規模に十分、セットアップ不要 |
| ORM/マイグレーション | Drizzle ORM | TypeScript親和性が高く、マイグレーションSQLを目視確認できる運用がしやすい |
| スタイリング | Tailwind CSS | デザインシステム(色・spacing・タイポグラフィのトークン化)を高速に一貫構築できる |
| UIコンポーネント基盤 | 自前の最小デザインシステム(shadcn/ui相当のヘッドレス+Tailwind) | 「Appleのようなシンプルさ」を独自トーンで作り込むため、既製テーマに寄せすぎない |
| テスト | Vitest + React Testing Library(unit/component)。E2Eは後続フェーズでPlaywright検討 | 高速・Next.jsとの親和性 |
| Lint/Format | ESLint + Prettier | 標準的な品質担保 |
| AI連携 | サーバーサイドのみでLLM呼び出し。`LLM_PROVIDER` 環境変数でプロバイダ切替可能な抽象層 | APIキーをクライアントに露出させない。将来のプロバイダ変更に耐える |
| 認証 | Phase 1〜2は**単一ユーザー・ローカル前提**(パスワードゲートのみ、必要なら)。マルチユーザー化は本ロードマップの範囲外(将来検討) | マスタープロンプトに認証の明示要件が無く、MVPの複雑度を上げないため |

> **確認事項**: DB/ORM/スタイリングは提案であり、既存資産の制約が無い今、代替案(例: Prisma、
> Postgres、CSS Modules)も選択可能。特段の理由が無ければ上記で進める。

## 3. ドメインモデル(概念設計)

```
Product
 ├─ ProductFact[]         (Fact | Hypothesis, source, confidence, capturedAt)
 ├─ ProductIntelligence   (AIが理解した価値提案・課題・ターゲット顧客のサマリ)
 └─ MarketIntelligence
     ├─ TargetCustomer[]
     ├─ CustomerProblem[]
     ├─ Competitor[]
     ├─ Channel[]              (顧客が情報を探す場所)
     └─ ResearchFinding[]      (根拠, source, capturedAt, Fact/Hypothesis区分)

Opportunity
 ├─ targetCustomer, problem, hypothesis, evidence[], recommendedChannel
 ├─ status (new | reviewing | approved | dismissed)
 └─ Experiment[]

Experiment
 ├─ purpose, hypothesis, target, channel, successMetric, period
 ├─ status (draft | pending_approval | active | completed | aborted)
 ├─ ContentDraft[]
 ├─ Execution[]
 └─ Outcome

ContentDraft
 ├─ content, revisionHistory[]
 └─ approval (pending | approved | rejected, approvedBy, approvedAt)

Execution
 ├─ type (manual | automated)
 ├─ status (queued | running | success | failed)
 ├─ channelIntegrationStatus
 └─ logs / errors

Outcome
 ├─ metrics (impressions, visits, signups, activation, …) — 計測できたもののみ記録
 ├─ linkedExperimentId
 └─ learnings[] (次のOpportunity候補への種)
```

**共通ルール**: すべてのレコードは `recordType: "fact" | "hypothesis"` (該当する場合)、
`source`, `capturedAt`/`createdAt` を持ち、AIが生成した値は必ず「AI生成」であることをメタデータで
追跡できるようにする(捏造禁止・根拠追跡の要件を満たすため)。

## 4. ディレクトリ構成(初期案)

```
src/
  app/                     # Next.js App Router
    (dashboard)/
      overview/
      products/
      market/
      opportunities/
      experiments/
      execution/
      results/
    api/                   # 必要な場合のみ(基本はServer Actions優先)
  components/
    ui/                    # デザインシステムの基礎コンポーネント(Button, Card, Badge, …)
    layout/                # AppShell, Nav, PageHeader
    features/              # 機能単位のコンポーネント(product/, market/, opportunity/…)
  server/
    actions/               # Server Actions
    ai/                     # LLM呼び出しの抽象化層
    db/                     # Drizzle schema, client, migrations
  lib/                     # 汎用ユーティリティ
docs/
drizzle/                   # マイグレーションSQL
tests/ もしくは各ファイル隣接の *.test.ts(未確定、Phase 1で決定)
```

## 5. AIワークフローのアーキテクチャ

- LLM呼び出しは全てサーバーサイド(`src/server/ai/`)に閉じ込め、呼び出し内容・レスポンス・
  取得日時・成否を監査可能な形でDBに保存する(将来の「AIが実行したこと/していないことの明確な区別」要件)。
- 各AI生成コンテンツには「未確認(AI仮説)」「確認済み(ユーザー承認)」のステータスを持たせる。
- APIキー未設定・エラー時は、UIに明示的なエラー状態を出す(捏造データで埋めない)。

## 6. 環境変数・シークレット管理

- `.env.local` にAPIキー等を保持(gitignore対象)。`.env.example` にキー名のみ記載してコミット。
- 想定する変数(初期案): `DATABASE_URL`(SQLiteファイルパス), `LLM_PROVIDER`, `ANTHROPIC_API_KEY`
  (もしくは選定プロバイダのキー), `GRAPE_ADMIN_PASSWORD`(任意・簡易アクセス制御用)。

## 7. 段階的自動化のための状態モデル

マスタープロンプト§6の3段階自動化に対応するため、Experiment/Executionレベルで
`automationLevel: "manual_approval" | "auto_routine" | "auto_constrained"` を持たせ、
Phase 1〜6では実質 `manual_approval` のみを実装し、UIとデータモデルは将来の拡張を阻害しない形にする。

## 8. 今回採用しないもの(理由付き)

- **マルチユーザー認証基盤**: 過去の計画ファイルに詳細設計があったが、コードが存在しない状態から
  再度作り込むのはMVPのスコープを超える。単一ユーザー運用で開始し、必要になった時点で別途設計する。
- **課金・プラン機能**: マスタープロンプトに要件なし。将来のスコープ。
