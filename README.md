# Grape

自分でWebアプリを開発・デプロイできるSolo Builderが、公開後の認知拡大・利用者獲得・改善を継続するための
AI Growth Experiment OS。

プロダクトの背景・設計方針は [docs/architecture.md](docs/architecture.md) を、
現在の実装状況とロードマップは [docs/implementation-roadmap.md](docs/implementation-roadmap.md) を参照。

## 開発を始める

```bash
pnpm install
cp .env.example .env.local   # 値を設定(AI機能を使う場合はANTHROPIC_API_KEY等)
pnpm dev
```

[http://localhost:3000](http://localhost:3000) を開く(`/overview` へ自動リダイレクト)。

## 主なコマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` | 開発サーバー起動 |
| `pnpm build` | 本番ビルド |
| `pnpm start` | 本番ビルドの起動 |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScriptの型チェック |
| `pnpm test` | Vitestでテスト実行 |
| `pnpm test:watch` | Vitestをwatchモードで実行 |
| `pnpm db:generate` | `src/server/db/schema.ts` からマイグレーションSQLを生成 |
| `pnpm db:migrate` | マイグレーションをDBに適用 |
| `pnpm db:studio` | Drizzle StudioでローカルDBを閲覧 |

## 技術スタック

Next.js (App Router) / React / TypeScript / Tailwind CSS / Drizzle ORM + SQLite / Vitest

## ディレクトリ構成

```
src/
  app/(app)/       # ダッシュボード各画面(Overview, Products, Market, Opportunities, Experiments, Execution, Results)
  app/style-guide/ # 社内確認用のデザインシステムプレビュー(製品ナビには非表示)
  components/ui/   # 汎用UIコンポーネント(Button, Card, Badge, EmptyState, ErrorState, …)
  components/layout/ # AppShell, サイドナビ, PageHeader
  server/db/       # Drizzle ORM スキーマ・DBクライアント
  server/actions/  # Server Actions(今後追加)
  server/ai/       # LLM呼び出し層(今後追加)
docs/              # 調査・設計・ロードマップドキュメント
drizzle/           # マイグレーションSQL(生成物)
```
