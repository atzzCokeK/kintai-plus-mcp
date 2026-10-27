# 設計の決定事項

2026-10-27 時点の合意内容。背景と理由は [adr/](./adr/) を参照。

## 概要

- マネーフォワード クラウド勤怠Plus（旧 AKASHI）の **公開 API** に対応した **非公式** MCP サーバー。
- 個人 OSS（MIT）。不特定多数に使ってもらうプロダクトとして育てる。
- 対象はクラウド勤怠Plus のみ。マネーフォワード クラウド勤怠（本体）は公開 API がないため対象外。

## 名前と公開

- npm・GitHub ともに `kintai-plus-mcp`（スコープなし）。`npx kintai-plus-mcp` で起動。
- 公式 MCP Registry にも登録する。
- README 冒頭で「非公式」「マネーフォワード社とは無関係」「商標は各社に帰属」と明記。ロゴは使わない。
- README は日本語メイン＋英語の短い版。

## 技術構成

- TypeScript / MCP SDK v2（`@modelcontextprotocol/server`）/ Node 22+ / pnpm。
- ローカル実行（stdio）のみ。リモートでのホストはしない。
- 「勤怠の操作」を表すバックエンドのインターフェースを 1 枚だけ用意し、v1 は API 版のみ実装する。各バックエンドは対応機能（capabilities）を申告し、それに応じて公開するツールを決める。
- ブラウザモードは次バージョン以降。Playwright は任意依存（optional）にしてパッケージは 1 つのまま。

## 認証

- `npx kintai-plus-mcp login` で企業 ID・接続先（`atnd.ak4.jp` / `atnd-awj.ak4.jp`）・トークンを登録。
- 保存先は OS のキーチェーン。使えない環境では本人のみ読み書きできるファイル（`~/.config/kintai-plus-mcp/credentials.json`、パスは環境変数で変更可）。
  - Linux は Secret Service を明示指定する（未指定だと再起動で消えるカーネルキーリングに黙って切り替わるため）。
- 環境変数（`KINTAI_PLUS_TOKEN` など）からは、保存先が空のときだけ初回取り込みし、以降は保存先を正とする。
- 有効期限の残りが **15 日**（設定で変更可）を切ったら再発行 API で自動更新。複数プロセスでの二重更新はロックで防ぎ、更新前に保存先を読み直す。
- 失効したら、マイページでの再発行と `login` を案内する。
- ログやエラーに出る URL からトークンを必ず消す。

## ツール

- 起動時に権限（企業管理者／一般管理者／従業員）を確認し、一般の従業員には管理者向けツールを見せない。
- 全員向け: `get_my_profile`, `get_today_status`（未出勤／勤務中／休憩中／退勤済みと、ここまでの勤務時間）, `punch`【書】, `get_stamps`, `get_working_records`, `get_alerts`, `list_projects`, `list_tasks`, `get_my_projects`, `get_manhours`, `save_manhours`【書】, `delete_manhours`【書】, `summarize_working_hours`
- 管理者向け: `list_staff`, `get_team_stamps`, `get_working_statuses`, `get_project_members`
- 非対応（v1）: 人事マスタの書き込み（従業員の登録・削除、権限、異動、個別就業設定、勤務処理の更新、組織作成、プロジェクト/タスクの作成・削除、プロジェクト従業員の追加・解除）、申請、スケジュール。
- ツール名は英語の snake_case。説明文も英語で、勤怠用語は日本語を併記。

## 書き込みの安全策

- 確認ダイアログは既定で出さない。
- 打刻の種別は必須（API の「省略時に出勤/退勤を自動切り替え」は使わない）。
- その日の打刻履歴と矛盾する打刻は弾く。`force: true` で実行可能。
- 書き込みツールは `destructiveHint` を申告する。
- 任意で `CONFIRM_WRITES=true`（Elicitation で確認）と読み取り専用モードを選べる。

## データの扱い

- API の制約（勤務実績 31 日、打刻 6 ヶ月/1000 件、従業員 20 人/ページ、複数従業員打刻 1 日/50 人）はサーバー側で分割・ページ送りする。上限を設け、リクエスト間隔も控えめにする。
- 残業は「法定時間外の目安」（労働日は 1 日 8 時間超、法定休日は全時間）として集計し、目安であることを必ず添える。
- 打刻の緯度・経度と IP アドレスは既定で AI に渡さない。従業員情報も必要最小限に絞る。
- タイムゾーンは日本時間（Asia/Tokyo）固定。ログは stderr のみ。

## 品質とリリース

- 実装は TDD。
- 公開 CI はモックと匿名化済みフィクスチャのみ。実環境の E2E は手元でのみ実行。
- semver。1.0 以降はツール名と引数を互換性の対象にする。
- Changesets で変更履歴を管理し、GitHub Actions から Trusted Publishing + provenance で npm に公開する。
