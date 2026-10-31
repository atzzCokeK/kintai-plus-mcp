# リリース手順

初回の公開と、その後のリリースで行うこと。

## 初回だけ

1. Public 化の前に `docs/` を見直す（tasks.md T12。社内情報・個人情報・未公開の判断が残っていないか）
2. リポジトリを Public にする
3. npm に `kintai-plus-mcp` を初回公開する（Trusted Publisher はパッケージが存在しないと設定できないため）
   - Node 22 以上で `rm -rf node_modules && pnpm install --frozen-lockfile && pnpm test && pnpm build`（`pnpm exec node -v` で pnpm が使う Node も確認する。古い Node で入れた node_modules が残っていると rolldown の native binding が見つからずに失敗する）
   - npm アカウントの 2 段階認証を有効にしてから `npm publish --access public --provenance=false --otp=<6 桁>`。package.json で provenance を有効にしているが、provenance は CI の中でしか作れないので手元では外す
   - 公開後に `npm view kintai-plus-mcp version bin` で bin が残っていることを確認し、`git tag v<version> <commit> && git push origin v<version>`
   - もしくは、npm の「Trusted Publisher」を新規パッケージにも設定できる場合は、それを使う
4. npm のパッケージ設定 > Trusted Publisher に GitHub Actions を登録する
   - Organization/user: `atzzCokeK`、Repository: `kintai-plus-mcp`、Workflow: `release.yml`
5. MCP Registry: 名前 `io.github.atzzCokeK/kintai-plus-mcp` は GitHub の OIDC で認証される（`mcp-publisher login github-oidc`）。npm パッケージの `mcpName` と一致している必要がある

## 毎回

1. 変更を入れる PR で `pnpm changeset` を実行し、changeset ファイルをコミットする
2. main にマージすると、Release ワークフローが「chore: release」PR を作る（バージョン・CHANGELOG・server.json を更新）。この PR を作るには、Settings > Actions > General > Workflow permissions で「Allow GitHub Actions to create and approve pull requests」を有効にする
3. その PR をマージすると、npm に provenance 付きで公開し、`v<version>` タグを打ち、MCP Registry に公開する

## 確認すること

- `server.json` のバージョンは `pnpm version-packages` で package.json に合わせる（`test/release.test.ts` がずれを検出する）
- npm の Trusted Publishing には npm CLI 11.5.1 以上が必要（ワークフローで最新にしている）
- 公開は「未処理の changeset がないとき」だけ行う。changeset が残っていると changesets/action が作業ツリーのバージョンを上げるため、その状態で公開すると未リリースの版が出てしまう（2026-10-30 に 0.1.1 を公開しかけた。npm 側の設定がなく失敗したので実害はなし）
