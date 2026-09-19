# Current State — Phase 0 調査結果

調査日: 2026-09-19

## 1. 結論(先に要約)

**`C:\Dev\Grape` には現在、ファイルが一切存在しない。** Gitリポジトリでもない。

一方、このマシンのClaude Codeセッション履歴には、同じパスで開発されていた実在のGrapeプロジェクト
(2026-09-11時点で稼働、テスト396件パス、git branch `master`)の記録が残っている。しかし本体・`.git`
を含むディレクトリの中身は失われており、Recycle Bin・OneDrive・ローカルZIPバックアップいずれにも
コピーは見つからなかった。

利用者と確認の上、**復旧は行わず、この空の状態からグリーンフィールドとして再構築する**ことで合意した。
以降の調査・設計・ロードマップは、この前提(＝既存コードは存在しない)に基づく。

## 2. 直接確認した事実

| 項目 | 結果 |
|---|---|
| `C:\Dev\Grape` の中身 | 空(`.`と`..`のみ、隠しファイルも無し) |
| Gitリポジトリか | いいえ(`git status` → `fatal: not a git repository`) |
| Recycle Bin / OneDrive / ZIPバックアップ探索 | 該当なし |
| Node.js | v22.19.0 |
| npm | 10.9.3 |
| pnpm | 10.15.1 |
| yarn | 1.22.21 |
| git | 2.44.0.windows.1 |
| sqlite3 CLI | 3.50.4 |
| OS | Windows 10 Home (MINGW64/Git Bash経由) |

開発に必要なツールチェーン(Node, pnpm, git, sqlite3)はすべて利用可能な状態。

## 3. セッション履歴からわかった過去の経緯(参考情報)

以下は `~/.claude/projects/c--Dev-Grape/` に残っていたセッション記録および
`~/.claude/plans/1-grape-growth-quirky-chipmunk.md` から判明した、**失われた過去のプロジェクトの痕跡**。
コードは再利用できないため実装の土台にはしないが、過去に検討・決定されていた方向性として記録しておく。

- 直近セッションは 2026-09-11 16:25 まで活動。gitブランチは `master`。
- 当時の状態: **テスト396件・lint・typecheck・build すべてクリーン**。ただし21ファイルが未コミット。
- 実装されていたらしき機能・ファイル(パスのみ判明、内容は不明):
  - `src/server/session.ts` — セッション/トークン管理
  - `src/proxy.ts` — アクセス制御(ループバック無条件許可のロジックあり)
  - `src/components/nav/account-menu.tsx` — アカウントメニュー(プラン・請求は意図的に非表示)
  - `products/[id]/page.tsx`, `funnel/page.tsx`, `tasks/page.tsx`, `api/products/route.ts`
  - `src/db/schema.ts` + Drizzleマイグレーション(`drizzle/0005_*.sql`)
  - URLからSaaS情報をAIが分析し構造化レポートを出す機能(直近の作業テーマ)。
    `LLM_PROVIDER=anthropic` / `ANTHROPIC_API_KEY` を環境変数で切り替える設計だった。
- 残っていた未着手/着手途中の計画(`1-grape-growth-quirky-chipmunk.md`、2026-09-09付):
  マルチユーザー化(users/invitesテーブル、scryptパスワードハッシュ、署名付きセッションCookie、
  所有者チェックの欠如の是正など)。**この計画は今回の再構築では採用しない**(コードが無いため前提が崩れている)。
  ただし「開発時はlocalhostなら自動ログイン」「課金機能は当面持たない(自前ホスティング)」といった
  設計思想は、今回のマスタープロンプトとも矛盾しないため、Phase 1以降で軽量な形で踏襲を検討する価値がある。
- 技術スタックの推定(セッション履歴の言語・コマンドから): Next.js, TypeScript, pnpm, Drizzle ORM,
  SQLite, Vitest相当のテストランナー。これはマスタープロンプト7章の想定スタックとも一致する。

**重要な注意**: 上記はテキストログからの推測であり、実際のコード品質・実装の正しさは検証できない
(コードそのものが存在しないため)。したがって「参考情報」以上の重みを与えず、今回の設計判断は
マスタープロンプトの要件から独立して行う。

## 4. 再利用できるもの

**なし。** コード資産は存在しないため、Phase 1は完全新規のプロジェクト初期化から開始する。

過去の設計思想のうち、次の点は「知見」として参考にする(コードではなく方針として):

- 単一ユーザー・ローカル前提で始め、認証は最小限からスタートする段階的アプローチ
- 環境変数でLLMプロバイダを切り替える設計
- Fact / Hypothesis の区別を早期にデータモデルへ組み込む必要性(マスタープロンプトの要件とも一致)

## 5. 修正が必要なもの

該当なし(既存コードが無いため)。

## 6. 重大な技術的リスク

1. **データ損失の再発防止**: 今回のインシデントの直接原因は特定できていない(セッションログにも
   削除コマンドの実行記録は見当たらない)。Phase 1着手時に**必ず `git init` し、早期から頻繁にコミットする**
   運用を徹底する。可能であればリモート(GitHubなど)へのpushも検討する。
2. **APIキーの検証未了**: 過去の環境では `ANTHROPIC_API_KEY` がClaude Code内部用のトークンであり、
   公開Anthropic APIには使えなかった(401エラー)という記録が残っている。AI機能を実装するフェーズ
   (Phase 3以降)で、利用者自身のAPIキーを別途 `.env` に設定する必要がある。
3. **既存DBデータなし**: マスタープロンプト7章は「既存のデータやスキーマとの互換性を確認する」ことを
   求めているが、DBファイル自体が存在しないため、この制約は今回のPhase 0時点では該当しない
   (Phase 2でスキーマを新規設計する)。

## 7. Phase 1で行う内容

「UI Foundation」に入る前に、プロジェクトの初期化(`git init`、Next.jsプロジェクト作成、
基本ツールチェーンのセットアップ)が必要になる。詳細は [implementation-roadmap.md](./implementation-roadmap.md) を参照。

## 8. Firebaseへの移行(2026-09-19、Phase 2着手時)

Phase 1完了・Phase 2着手後、利用者の指示により **DB/クラウド技術をSQLite+Drizzle ORMから
Firebase(Firestore)に変更**した。

### 経緯

- Phase 1では、マスタープロンプト7章の想定に沿って SQLite + Drizzle ORM でプロジェクトを初期化し、
  Phase 2(Product Onboarding)のCRUD機能を実装・テスト・E2E確認まで完了していた。
- Phase 2の途中で利用者から「DBやそのほかクラウド技術はFirebaseを利用する」との指示があり、以下を確認した上で方針転換した:
  - Firebaseプロジェクト: 新規作成(`grape-growth-os`)
  - 導入範囲: **Firestore(DB)+ Firebase Hostingへのデプロイ**(Firebase Authは今回のスコープ外)
  - Firestoreリージョン: `asia-northeast1`(東京)

### 実施内容

- `firebase-tools` CLI(ログイン済み: shun.aizawa2001@gmail.com)経由でFirebaseプロジェクト
  `grape-growth-os` を新規作成
- Firestore(Standard Edition, asia-northeast1)を作成
- サーバー専用のIAMサービスアカウント `grape-app-server` を作成し、`roles/datastore.user` のみ付与
  (最小権限)。キーを発行し `.env.local` に格納(リポジトリにもディスクにも鍵ファイルは残していない)
- `firestore.rules` でクライアント(ブラウザ)からの読み書きを全拒否に設定・デプロイ。
  データアクセスはすべてFirebase Admin SDK経由・サーバーサイドのみに限定する設計とした
  (Firebase Auth未導入のため、Firestoreルールでのユーザー単位アクセス制御ができない制約への対応)
- SQLite/Drizzle関連のコード・依存関係(`better-sqlite3`, `drizzle-orm`, `drizzle-kit` 等)を削除し、
  Firestoreベースのデータアクセス層(`src/server/firebase/`)に置き換え
- テストはFirestoreエミュレータ(`firebase emulators:exec`)上で実行するよう変更。
  `pnpm dev` もエミュレータ経由で起動し、**ローカル開発が本番Firestoreを汚さない**ようにした

### 既知の制約・今後の検討事項

- **認証なしで公開する場合のリスク**: 今回のスコープにFirebase Authは含まれていない。
  Firebase Hostingへ実際にデプロイした場合、Next.jsアプリ自体はログイン機能を持たないため、
  URLを知る誰でもアクセスできる状態になる。個人利用の間は許容範囲だが、公開URLを配布する前に
  最低限のアクセス制御(簡易パスワードゲート等)の導入を推奨する。
- Firebase Hostingへのデプロイ(App Hosting)の具体的な設定は、本ドキュメント作成時点で
  [implementation-roadmap.md](./implementation-roadmap.md) と Phase 2完了報告にて別途記載する。
