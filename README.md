# Grape

自分でWebアプリを開発・デプロイできるSolo Builderが、公開後の認知拡大・利用者獲得・改善を継続するための
AI Growth Experiment OS。

プロダクトの背景・設計方針は [docs/architecture.md](docs/architecture.md) を、
現在の実装状況とロードマップは [docs/implementation-roadmap.md](docs/implementation-roadmap.md) を参照。

## 前提ツール

- Node.js 22 / pnpm
- [Firebase CLI](https://firebase.google.com/docs/cli)(`npm i -g firebase-tools`)、`firebase login` 済みであること
- Java(Firestoreエミュレータの実行に必要。`java -version` で確認)

## 開発を始める

```bash
pnpm install
cp .env.example .env.local   # Firebaseのサービスアカウント情報などを設定
pnpm dev
```

`pnpm dev` は Firestoreエミュレータを自動起動してから `next dev` を実行する
(`firebase emulators:exec`)。**本番のFirestoreには書き込まない。**
本番データに対してdevサーバーを動かしたい場合のみ `pnpm dev:prod-data` を使う(通常は非推奨)。

[http://localhost:3000](http://localhost:3000) を開く(`/overview` へ自動リダイレクト)。

## 主なコマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` | Firestoreエミュレータ + 開発サーバー起動 |
| `pnpm dev:prod-data` | エミュレータを使わず、本番Firestoreに接続して開発サーバー起動 |
| `pnpm build` | 本番ビルド |
| `pnpm start` | 本番ビルドの起動 |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScriptの型チェック |
| `pnpm test` | Firestoreエミュレータ上でVitestを実行 |
| `pnpm test:watch` | 同上、watchモード |
| `firebase deploy --only firestore:rules` | Firestoreセキュリティルールをデプロイ |

## デプロイ

Firebase App Hosting で本番稼働中。

- 本番URL: https://grape-backend--grape-growth-os.us-east4.hosted.app
- GitHub `main` ブランチへ push すると自動でビルド・デプロイされる

```bash
git push origin main   # これだけで本番に反映される
```

本番環境の認証は **Application Default Credentials** を使う。App Hosting のサービスアカウントが
Firestore へのアクセス権を持つため、**秘密鍵などの環境変数設定は不要**。

> ⚠ 現在ログイン機能が無いため、URLを知っていれば誰でもアクセスできる。
> URLを他者に共有する前にアクセス制御の追加が必要。

## 技術スタック

Next.js (App Router) / React / TypeScript / Tailwind CSS / Firebase (Firestore + Admin SDK) /
Anthropic Claude (Opus 5, 構造化出力・Web検索) / Vitest

データベースはFirestoreを使用する。クライアント(ブラウザ)からは直接アクセスせず
(`firestore.rules` で全拒否)、すべての読み書きはサーバー側(Server Actions /
Server Components)からFirebase Admin SDK経由で行う。

## ディレクトリ構成

```
src/
  app/(app)/          # ダッシュボード各画面(Overview, Products, Market, Opportunities, Experiments, Execution, Results)
  app/style-guide/    # 社内確認用のデザインシステムプレビュー(製品ナビには非表示)
  components/ui/      # 汎用UIコンポーネント(Button, Card, Badge, EmptyState, ErrorState, …)
  components/layout/  # AppShell, サイドナビ, PageHeader
  server/firebase/    # Firebase Admin SDK初期化・Firestoreデータアクセス層
  server/actions/     # Server Actions
  server/ai/          # LLM呼び出し層(今後追加)
docs/                 # 調査・設計・ロードマップドキュメント
firebase.json / .firebaserc / firestore.rules / firestore.indexes.json
                       # Firebaseプロジェクト設定
```
