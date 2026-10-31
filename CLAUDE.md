# kintai-plus-mcp 開発ルール

マネーフォワード クラウド勤怠Plus（旧 AKASHI）公開 API 向けの非公式 MCP サーバー。

## セッション開始時に読むもの

1. GitHub の open な Issues（と open な PR）— 何が残っていて次に何をやるか
2. `docs/design.md` — 合意済みの決定事項（変えるときはユーザーに確認する）
3. 着手するタスクに関係するもの
   - API を叩く処理: `docs/api-notes.md`（クラウド勤怠Plus 公開 API の要約。日付形式や制約が API ごとに違う）
   - SDK・キーチェーンなど: `docs/tech-notes.md`
   - 判断の背景: `docs/adr/`

## 進め方

- タスクは GitHub Issues で管理する。1 つの Issue（または関連する小さな変更のまとまり）ごとにブランチと PR を作り、PR 本文に `Closes #<番号>` を書く。CI が通ったら main にマージしてから次に進む。
- 新しくやることが見つかったら Issue を作る。リポジトリにタスク一覧のファイルは置かない。
- セッションを終える前に、進行中の Issue に状況（途中で決めたこと、次にやること、詰まっている点）をコメントで残す。調べてわかった API や技術の事実は `docs/api-notes.md` / `docs/tech-notes.md` に追記する。会話の中にしかない情報を残さない。
- 実装は **必ず TDD**（Red → Green → Refactor）。失敗するテストを先に書き、そのテストが落ちることを確認してから実装する。
- 設計判断は `docs/design.md`（決定事項の一覧）と `docs/adr/`（背景・理由）に残す。新しい判断をしたら ADR を追加する。
- `docs/` もコミットする。トークン、実在の企業や従業員の情報、その他の個人情報は書かない。

## 技術スタック

- TypeScript / Node 22+ / pnpm
- MCP SDK v2: `@modelcontextprotocol/server`（stdio は `@modelcontextprotocol/server/stdio` の `serveStdio`）
- テスト: Vitest、Lint/Format: Biome、ビルド: tsdown
- ライブラリの仕様は推測せず、Context7 で最新ドキュメントを確認してから使う。

## 守ること

- トークンはログ・エラーメッセージ・テストのスナップショットに絶対に出さない（URL のクエリに載る仕様なので特に注意）。
- 実環境のレスポンスをフィクスチャにするときは、氏名・社員番号・メール・部署名・位置情報・IP を架空の値に置き換える。
- 実環境を叩く E2E は手元でのみ実行し、CI には認証情報を置かない。
- ログは stderr のみ（stdout は MCP の通信路）。
