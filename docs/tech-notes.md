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
- **Linux では Secret Service がないと、黙ってカーネルの keyutils に切り替わり、再起動で消える。** `new Entry(s, a, { linux: { store: 'secret-service' } })` で明示指定し、使えなければ（コンストラクタが例外を投げたら）ファイル保存に切り替える
- keytar はアーカイブ済みなので使わない

## ツールチェーン

- Node 22 以上、pnpm、TypeScript 7、Vitest 5、tsdown、Biome 2
- CLI アプリなので型定義（.d.ts）の生成は不要
