# 技術メモ

2026-10-27 時点の調査結果。ライブラリを使う前に Context7 で最新ドキュメントを確認すること。

## MCP SDK v2（`@modelcontextprotocol/server` 2.4.x）

- 旧 `@modelcontextprotocol/sdk` に代わる安定版。ドキュメント: https://ts.sdk.modelcontextprotocol.io/v2/ （Context7 ID: `/websites/ts_sdk_modelcontextprotocol_io_v2`）
- stdio は `serveStdio(factory)`（`@modelcontextprotocol/server/stdio`）。既定 `legacy: 'serve'` で 2025 年版プロトコルのクライアントにも同じファクトリで応答する。ファクトリは接続ごとに 1 回呼ばれ、`McpServer` を同期で返す
- ツール登録: `server.registerTool(name, { title, description, inputSchema: z.object(...), outputSchema, annotations: { readOnlyHint, destructiveHint, idempotentHint } }, handler)`。zod は `import * as z from 'zod/v4'`
- 失敗はハンドラから `{ content: [...], isError: true }` を返す（対処のヒントを本文に入れる）
- Elicitation（確認ダイアログ）: 2026-07-28 版仕様では、ツールが `inputRequired({ inputRequests: { confirm: inputRequired.elicit({ message, requestedSchema }) } })` を返し、クライアントが回答付きで再呼び出しする方式。回答は `acceptedContent(ctx.mcpReq.inputResponses, 'confirm', schema)` で取り出す。クライアントが未対応だとエラー（-32021）になる。旧方式の `ctx.mcpReq.elicitInput()` は非推奨
- 仕様上、Elicitation の form モードでパスワードやトークンを聞いてはいけない

## クライアントの対応状況（Elicitation）

| クライアント | 対応 |
|---|---|
| Claude Code | あり |
| Cursor | あり |
| VS Code（Copilot） | あり |
| Codex | おそらくあり |
| Claude Desktop | 不明（おそらくなし） |
| ChatGPT / Gemini CLI | なし |

- Claude Code は `destructiveHint` などのツール注釈で承認方法を変えない（MCP ツールはすべて同じように承認を求める）。VS Code は `readOnlyHint` のツールの確認を省く

## キーチェーン（`@napi-rs/keyring` 2.1.x）

- `new Entry(service, account)` → `getPassword()` / `setPassword()` / `deletePassword()`
- **Linux では Secret Service がないと、黙ってカーネルの keyutils に切り替わり、再起動で消える。** `new Entry(s, a, { linux: { store: 'secret-service' } })` で明示指定する
- Secret Service が使えない環境（D-Bus セッションなし）でも **コンストラクタは成功し、`getPassword()` などの呼び出しで例外**（`Platform failure: DBus error ...`）になる（2026-10-27 に確認）。そのため使えるかどうかは `getPassword()` を試して判定し（`KeychainCredentialStore.probe()`）、失敗したらファイル保存に切り替える
- 非同期版の `AsyncEntry` を使う（イベントループを止めないため）
- keytar はアーカイブ済みなので使わない

## ツールチェーン

- Node 22 以上、pnpm、TypeScript 7、Vitest 5、tsdown、Biome 2
- CLI アプリなので型定義（.d.ts）の生成は不要

## リポジトリ設定の決めごと（T1）

- ソースの相対 import は `.ts` 拡張子付きで書く（`allowImportingTsExtensions` + `noEmit`。ビルドは tsdown がバンドルする）
- バージョンは `src/version.ts` が package.json を JSON import して公開する。tsdown が値だけインライン化する
- Biome は Markdown を対象外にしている（2.6 は Markdown も整形し、docs の見た目が変わるため）
- `changeset init` は対話式で、非 TTY では止まる。`.changeset/config.json` は手で書いた（changelog は `@changesets/changelog-github`、access は public）
- `changeset status` はローカルに `main` ブランチがないと失敗する（CI では fetch-depth に注意）

## 認証情報の保存（T3）

- キーチェーンのサービス名 `kintai-plus-mcp`、アカウント名 `default`。値は認証情報の JSON（`src/credentials/types.ts` の形）
- 環境変数: `KINTAI_PLUS_CREDENTIAL_STORE`（auto / keychain / file）、`KINTAI_PLUS_CREDENTIALS_FILE`（指定するとファイル保存）、初回取り込み用に `KINTAI_PLUS_TOKEN` / `KINTAI_PLUS_COMPANY_ID` / `KINTAI_PLUS_HOST`（省略時 atnd.ak4.jp）
- ファイル保存は一時ファイルに書いてから rename で置き換える。読むときに権限が緩ければ 600 に直して警告する

## CLI（T4）

- `src/cli/main.ts` の `runCli(argv, deps)` が本体。入出力・API・サーバー起動は差し替え可能（テストは偽の fetch と一時ディレクトリのファイル保存で通しで確認）
- プロンプトは stderr に出す。トークン入力中は readline のエコーを止める
- パイプ入力では、readline が質問の前に届いた行を捨ててしまうため、読んだ行をキューに溜めて順に渡す（`src/cli/io.ts`）
- `login` は「自分の従業員情報の取得で疎通確認 → 再発行で有効期限を確定（ADR 0007）→ 保存」。再発行に失敗しても疎通できたトークンは期限不明で保存する
- 環境設定: `KINTAI_PLUS_REFRESH_DAYS`（1〜30、既定 15）、`KINTAI_PLUS_AUTO_REFRESH`、`KINTAI_PLUS_READ_ONLY`、`CONFIRM_WRITES`、`KINTAI_PLUS_INCLUDE_LOCATION`、`KINTAI_PLUS_LOG_LEVEL`、`KINTAI_PLUS_MIN_INTERVAL_MS`（100〜60000、既定 300）。`src/config.ts`
