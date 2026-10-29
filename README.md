# kintai-plus-mcp

> **非公式** の MCP サーバーです。株式会社マネーフォワードとは関係がなく、同社による確認・保証は受けていません。
> 「マネーフォワード クラウド勤怠Plus」「AKASHI」などの名称・商標は、それぞれの権利者に帰属します。

[マネーフォワード クラウド勤怠Plus](https://biz.moneyforward.com/attendance-plus/)（旧 AKASHI）の公開 API を、Claude などの AI アシスタントから使えるようにする [Model Context Protocol](https://modelcontextprotocol.io) サーバーです。

「出勤して」「今月の残業はどれくらい？」「昨日の工数を設計 2 時間・実装 5 時間で入れて」のように話しかけるだけで、打刻・勤務実績の確認・工数入力ができます。

- 手元の PC で動くローカルの stdio サーバーです（トークンを第三者のサーバーに預けません）
- トークンは OS のキーチェーンに保存し、有効期限が近づくと自動で再発行します
- 打刻の位置情報・IP アドレスは、既定では AI に渡しません

公開 API の仕様（公式）: [マネーフォワード クラウド勤怠Plus 公開API 仕様](https://akashi.zendesk.com/hc/ja/articles/115000475854)

> v0.1 は開発中です。主要な応答の形は実環境で確認済みです。まだ未確認の点は [docs/api-notes.md](./docs/api-notes.md) の「未確認事項」にあります。

## できること

| ツール | 内容 |
|---|---|
| `get_my_profile` | 自分の従業員情報と権限 |
| `get_today_status` | 今日の状況（未出勤／勤務中／休憩中／退勤済み）と、ここまでの勤務時間 |
| `punch` 【書き込み】 | 打刻（出勤・退勤・直行・直帰・休憩入・休憩戻、テレワーク） |
| `get_stamps` | 打刻履歴（長い期間は自動で分割） |
| `get_working_records` | 勤務実績（労働区分・時刻・実働・休憩。31 日ごとに自動で分割） |
| `summarize_working_hours` | 実働合計・出勤日数・休日出勤日数・法定時間外の目安（月ごとの内訳つき） |
| `get_alerts` | アラート（打刻忘れ、遅刻、36協定 など） |
| `check_attendance_issues` | 打刻漏れチェック（退勤・出勤・休憩戻の打刻忘れ、12 時間超の日、勤務間インターバル 11 時間未満、休日出勤） |
| `list_projects` / `list_tasks` / `get_my_projects` | プロジェクトとタスク |
| `get_manhours` | 工数（プロジェクト名・タスク名つき） |
| `save_manhours` 【書き込み】 / `delete_manhours` 【書き込み】 | 工数の登録・更新・削除 |

管理者（企業管理者・一般管理者）には、次のツールも表示されます。一般の従業員には表示されません。

| ツール | 内容 |
|---|---|
| `list_staff` | 管理下の従業員の一覧（ID・氏名・社員番号・所属のみ） |
| `get_team_stamps` | 管理下の従業員の 1 日分の打刻と状況 |
| `get_working_statuses` | 勤務処理（欠勤・出張など） |
| `get_project_members` | プロジェクトのメンバー |
| `find_overtime_risks` | 残業リスク検出（今月の法定時間外の目安と月末の着地予測。既定のしきい値は 45 時間） |

### 定型プロンプト

対応しているクライアントでは、メニューから次のプロンプトを呼び出せます（使うツールが公開されているときだけ表示）。

| プロンプト | 内容 |
|---|---|
| `end_of_day` | 退勤前チェック（今日の勤務と工数を確認し、入力漏れを埋めてから退勤を打刻） |
| `log_manhours` | 工数を入力する（日付と、やったことを渡せる） |
| `monthly_review` | 月の振り返り（勤務時間・残業の目安・打刻漏れ・アラート） |
| `team_status` | 管理者向け: チームの今日の状況と残業リスク |

## 必要なもの

- Node.js 22 以上
- クラウド勤怠Plus の API トークン（下の「API トークンの発行」）

## セットアップ

### 1. API トークンの発行

**管理者が行うこと**（一度だけ）: 従業員設定 > 対象の従業員の「変更」 > 利用機能設定 で、「公開API利用可否」を「利用する」にします。

**本人が行うこと**: マイページ > APIトークン で発行します。トークンの有効期限は 1 ヶ月と 1 日です（このツールが自動で再発行します）。

> このツール専用のトークンを発行してください。初回の利用時と期限が近づいたときに再発行するため、同じトークンを他のツールで使っていると、そちらが使えなくなることがあります。

### 2. ログイン

```sh
npx kintai-plus-mcp login
```

次の 3 つを聞かれます。

- **ログイン企業ID**
- **接続先**: ログイン後のブラウザの URL のドメイン（`atnd.ak4.jp` または `atnd-awj.ak4.jp`）
- **APIトークン**（入力は表示されません）

疎通を確認してから保存します。状態の確認と削除は次のとおりです。

```sh
npx kintai-plus-mcp status   # 保存先・有効期限・権限（トークンは表示しません）
npx kintai-plus-mcp logout   # 保存した認証情報を削除
```

### 3. AI クライアントへの登録

<details open>
<summary>Claude Desktop</summary>

`claude_desktop_config.json` に追加します。

```json
{
  "mcpServers": {
    "kintai-plus": {
      "command": "npx",
      "args": ["-y", "kintai-plus-mcp"]
    }
  }
}
```
</details>

<details>
<summary>Claude Code</summary>

```sh
claude mcp add kintai-plus -- npx -y kintai-plus-mcp
```
</details>

<details>
<summary>Cursor</summary>

`~/.cursor/mcp.json`（またはプロジェクトの `.cursor/mcp.json`）:

```json
{
  "mcpServers": {
    "kintai-plus": {
      "command": "npx",
      "args": ["-y", "kintai-plus-mcp"]
    }
  }
}
```
</details>

<details>
<summary>VS Code（GitHub Copilot）</summary>

`.vscode/mcp.json`:

```json
{
  "servers": {
    "kintai-plus": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "kintai-plus-mcp"]
    }
  }
}
```
</details>

<details>
<summary>Codex CLI</summary>

`~/.codex/config.toml`:

```toml
[mcp_servers.kintai-plus]
command = "npx"
args = ["-y", "kintai-plus-mcp"]
```
</details>

## 設定（環境変数）

| 変数 | 既定 | 内容 |
|---|---|---|
| `KINTAI_PLUS_READ_ONLY` | `false` | `true` で書き込みツール（打刻・工数）を出さない |
| `CONFIRM_WRITES` | `false` | `true` で書き込みの前に確認ダイアログを出す（Elicitation に対応したクライアントのみ。未対応のクライアントでは書き込みが失敗します） |
| `KINTAI_PLUS_INCLUDE_LOCATION` | `false` | `true` で打刻の位置情報・IP を返す |
| `KINTAI_PLUS_REFRESH_DAYS` | `15` | 有効期限の残りがこの日数を切ったら再発行する（1〜30） |
| `KINTAI_PLUS_AUTO_REFRESH` | `true` | `false` で自動の再発行を止める |
| `KINTAI_PLUS_CREDENTIAL_STORE` | `auto` | 保存先: `auto`（キーチェーン → ファイル）/ `keychain` / `file` |
| `KINTAI_PLUS_CREDENTIALS_FILE` | `~/.config/kintai-plus-mcp/credentials.json` | ファイル保存のパス（指定するとファイル保存になる） |
| `KINTAI_PLUS_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` / `silent`（ログは stderr のみ） |
| `KINTAI_PLUS_MIN_INTERVAL_MS` | `300` | API リクエストの最小間隔（ミリ秒） |

### キーチェーンのない環境（サーバー上のボットなど）

キーチェーンが使えない環境では、本人だけが読み書きできるファイル（パーミッション 600）に保存します。`login` を対話で行えない場合は、環境変数で初回だけ取り込めます。

```sh
KINTAI_PLUS_TOKEN=... KINTAI_PLUS_COMPANY_ID=... KINTAI_PLUS_HOST=atnd.ak4.jp npx kintai-plus-mcp
```

保存先が空のときだけ取り込み、以降は保存先の値（自動で再発行されたもの）を使います。

## 制約

- **申請（残業・休暇・打刻修正など）とスケジュールには対応していません**（公開 API にないため）
- **打刻はサーバーに届いた時刻で記録され、API からは修正・削除できません。** 間違えた場合は Web 画面から申請してください。このため、その日の打刻と矛盾する打刻（出勤済みなのに出勤、など）は実行しません。どうしても必要なときは AI に「強制して」と伝えてください（`force`）
- 残業時間は API にないため、「法定時間外の目安」（労働日・所定休日は 1 日 8 時間超、法定休日は全時間）として計算します。週 40 時間・変形労働時間制・フレックスは考慮しません。正式な値は勤怠Plus や給与計算で確認してください
- API の制約（勤務実績は 31 日、打刻は 6 ヶ月・1000 件、従業員一覧は 20 人/ページ、複数従業員の打刻は 1 日・50 人）は、サーバー側で分割・ページ送りします。1 回の呼び出しで取得できる期間には上限があります
- タイムゾーンは日本時間（Asia/Tokyo）固定です
- 人事マスタの書き込み（従業員の登録・削除、権限、異動など）は扱いません

## セキュリティとプライバシー

- トークンは OS のキーチェーン（macOS キーチェーン、Windows 資格情報マネージャー、Linux の Secret Service）に保存します。Linux で Secret Service がない場合は、再起動で消えるカーネルのキーリングではなく、ファイル（600）に保存します
- トークンは URL に載る API 仕様のため、ログ・エラーメッセージから必ず取り除きます
- 打刻の位置情報・IP は既定で AI に渡しません。従業員情報も ID・氏名・社員番号・所属に絞ります（メールアドレスは渡しません）
- `logout` は手元の認証情報を削除するだけです。トークン自体を無効にするには、マイページで操作してください

## 開発

```sh
pnpm install
pnpm test        # Vitest（モックと架空のフィクスチャのみ）
pnpm lint        # Biome
pnpm typecheck
pnpm build       # tsdown
pnpm e2e         # 実環境を叩く手動 E2E（読み取りのみ。手元でだけ実行）
```

設計の決定事項は [docs/design.md](./docs/design.md)、背景は [docs/adr/](./docs/adr/) にあります。

## ライセンス

[MIT](./LICENSE)

---

## English

**Unofficial** MCP server for the public API of "Money Forward Cloud Kintai Plus" (formerly AKASHI), a Japanese attendance management service.
This project is not affiliated with, endorsed by, or sponsored by Money Forward, Inc. All trademarks belong to their respective owners.

- Punch in/out, check today's status, view punch history, working records, alerts, and man-hours, and record man-hours
- Admin tools (staff list, team punches, working statuses, project members) are shown only to admins
- Runs locally over stdio: `npx kintai-plus-mcp`. Register your token first with `npx kintai-plus-mcp login`
- The token is stored in the OS keychain (or a 600-permission file) and reissued automatically before it expires
- Location and IP address of punches are not sent to the AI by default
- Not supported: requests (申請) and schedules, because the public API does not provide them. Punches are recorded at the time the server receives them and cannot be edited via the API
- Requires Node.js 22+ and an API token issued from your Kintai Plus "My Page" (an admin must enable "公開API利用可否" for you)
- Official API reference (Japanese): https://akashi.zendesk.com/hc/ja/articles/115000475854
- License: MIT
