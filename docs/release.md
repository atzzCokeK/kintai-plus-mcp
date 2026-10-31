# リリース手順

初回の公開と、その後のリリースで行うこと。

## 初回だけ（0.1.0 で実施済み）

1. Public 化の前に `docs/` を見直す（トークン、実在の企業や従業員の情報、その他の個人情報が残っていないか）
2. npm に `kintai-plus-mcp` を初回公開する（Trusted Publisher はパッケージが存在しないと設定できないため、初回だけ手元から出す）
   - Node 22 以上で `rm -rf node_modules && pnpm install --frozen-lockfile && pnpm test && pnpm build`。`pnpm exec node -v` で pnpm が使う Node も確認する（古い Node で入れた node_modules が残っていると、rolldown の native binding が見つからずに失敗する）
   - npm アカウントの 2 段階認証を有効にしてから `npm publish --access public --provenance=false --otp=<6 桁>`。provenance は CI の中でしか作れないので、手元では外す
   - 新しい名前のパッケージは npm の段階的公開（staged publishing）に入り、`0.0.0-stage` という仮の版が先に公開される。npmjs.com の Staged Packages（または `npm stage approve <stage-id>`）で承認すると本物の版が `latest` になる
   - `npm view kintai-plus-mcp dist-tags version bin` で確認し、`git tag v<version> <commit> && git push origin v<version>`
3. npm のパッケージ設定 > Trusted Publisher に GitHub Actions を登録する
   - Organization or user: `atzzCokeK`、Repository: `kintai-plus-mcp`、Workflow filename: `release.yml`、Environment name: 空欄
   - 直接公開（`npm publish`）を許可する。段階的公開だけを許す設定だと、CI の公開が `403 OIDC permission denied for this action` で拒否される
   - Publishing access は「Require two-factor authentication and disallow bypass 2fa tokens」にする（CI は OIDC なので影響しない）
4. GitHub の Settings > Actions > General > Workflow permissions で「Allow GitHub Actions to create and approve pull requests」を有効にする（バージョンを上げる PR を作るため）
5. リポジトリを Public にする。provenance はソースのリポジトリが Public でないと付けられない（Private のままだと `422 ... repository visibility: "private"` で失敗する）
6. MCP Registry: 名前 `io.github.atzzCokeK/kintai-plus-mcp` は GitHub の OIDC で認証される（`mcp-publisher login github-oidc`）。npm パッケージの `mcpName` と一致している必要がある

## 毎回

1. 変更を入れる PR で `pnpm changeset` を実行し、changeset ファイルをコミットする
2. main にマージすると、Release ワークフローが「chore: release」PR を作る（バージョン・CHANGELOG・server.json を更新）。Actions が作った PR なので、CI の実行に承認が要ることがある
3. その PR をマージすると、npm に provenance 付きで公開し、`v<version>` タグを打ち、npm に新しい版が見えるまで待ってから MCP Registry に公開する
4. MCP Registry への登録だけが失敗した場合（npm の段階的公開で承認待ちになったときなど）は、ワークフローを再実行しても「公開済み」と判断されて登録まで進まない。npm で版が見えることを確認してから、main をチェックアウトした手元で `mcp-publisher login github && mcp-publisher publish` を実行する

## 確認すること

- `server.json` のバージョンは `pnpm version-packages` で package.json に合わせる（`test/release.test.ts` がずれを検出する）
- npm の Trusted Publishing には npm CLI 11.5.1 以上が必要（ワークフローで更新している）
- 公開は「未処理の changeset がないとき」だけ行う。changeset が残っていると changesets/action が作業ツリーのバージョンを上げるため、その状態で公開すると未リリースの版が出てしまう（`test/release.test.ts` でこの条件を確認している）
- ワークフローのアクションはコミット SHA で固定し、版をコメントで残す（`test/release.test.ts` で確認）。更新は Dependabot（`.github/dependabot.yml`）の PR で受け取る。npm と mcp-publisher も版を固定し、mcp-publisher はチェックサムを確かめる。mcp-publisher を上げるときは、リリースの `registry_<版>_checksums.txt` から `mcp-publisher_linux_amd64.tar.gz` の値を写す
- Release ワークフローは公開の権限（id-token）を持つので、依存のキャッシュを使わない（`package-manager-cache: false`）
