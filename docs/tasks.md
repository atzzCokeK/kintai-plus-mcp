# タスクリスト（v0.1.0）

1 タスクずつ TDD で進め、終わったらチェックを付けてコミットする。設計は [design.md](./design.md)。

## 現在の状況

- 最終更新: 2026-10-27
- v0.1.0 の実装は T1〜T12 まで完了。加えて「v0.1 以降の候補」のうち API だけでできる 3 つ（打刻漏れチェック、残業リスク検出、定型プロンプト）も実装済み（ツール 19、プロンプト 4、テスト 359 件。lint は警告でも失敗する設定）。ブランチ `claude/loop-engineering-tvx3ba`
- 残っているのはユーザーの判断・作業が要るもの:
  1. 実環境で `pnpm e2e --record` を実行し、[api-notes.md](./api-notes.md) の「未確認事項」を確かめる（応答の形・パラメータ名・page の始まり・DELETE の渡し方など）。違っていたらパーサーとフィクスチャを直す
  2. npm の初回公開と Trusted Publisher の設定、MCP Registry への公開、Public 化前の docs/ の見直し（手順は [release.md](./release.md)）
  3. ブラウザモード（申請・スケジュール）: ログインの扱い・規約の解釈・Playwright の扱いなど設計判断が必要（ADR 0001）。着手前に相談
- 途中で決めたこと（ユーザー未確認）: ADR 0007（期限不明のトークンは初回に再発行）、所定休日の時間外は 1 日 8 時間超で数える（design.md に追記）、自分の従業員情報は保存済みの staffId で取る、打刻漏れチェックの判定（夜勤は 16 時間以内、12 時間超・インターバル 11 時間未満を警告）、残業リスクの予測方法（ペース × 残りの平日、しきい値 45 時間）
- メモ: GitHub リポジトリ `atzzCokeK/kintai-plus-mcp` は Private。Public 化は v0.1.0 リリース時。リリース時のバージョンは changeset により 0.1.0 になる

## T1. リポジトリ基盤
- [x] package.json（`bin: kintai-plus-mcp`、Node 22+、ESM）、tsconfig、tsdown、Vitest、Biome
- [x] LICENSE（MIT）、.gitignore、README の骨組み（日本語＋英語の短い版、非公式の明記）
- [x] CI（GitHub Actions: lint / typecheck / test、Node 22・24）
- [x] Changesets の初期化

## T2. API クライアント
- [x] 接続先（`atnd.ak4.jp` / `atnd-awj.ak4.jp`）と企業 ID からの URL 組み立て
- [x] 共通レスポンス（`success` / `response` / `errors`）の解釈とエラーの正規化
- [x] URL・エラーメッセージからのトークン除去
- [x] リクエストの直列化と最小間隔（控えめなスロットリング）
- [x] 日時ユーティリティ（Asia/Tokyo 固定、API の日付形式との変換）
- [x] 期間分割（31 日／6 ヶ月）とページ送り（20 件）のヘルパー、上限

## T3. 認証情報ストアと自動更新
- [x] `CredentialStore` インターフェース
- [x] キーチェーン実装（Linux は Secret Service を明示）
- [x] ファイル実装（600、パスは環境変数で変更可）
- [x] 保存先の自動選択（キーチェーン → ファイル）
- [x] 環境変数からの初回取り込み
- [x] 再発行 API による自動更新（残り 15 日、設定可）、プロセス間ロック、更新前の読み直し
- [x] 失効時の案内メッセージ

## T4. CLI
- [x] 引数なし: MCP サーバー起動
- [x] `login`: 企業 ID・接続先・トークンを対話入力し、疎通確認して保存
- [x] `logout`: 保存した認証情報を削除
- [x] `status`: 保存先・有効期限・権限を表示（トークンは表示しない）

## T5. バックエンドのインターフェースと API 版の実装
- [x] `KintaiBackend` インターフェースと capabilities の申告
- [x] API 版の実装（T2 のクライアントを使う）。骨格とプロフィールまで。各操作は T7〜T9 のツールと一緒に `KintaiBackend` に足していく
- [x] 権限（企業管理者／一般管理者／従業員）の判定

## T6. MCP サーバーの骨組み
- [x] `serveStdio` での起動（旧プロトコルのクライアントにも対応）
- [x] capabilities と権限に応じたツール登録、読み取り専用モード
- [x] エラーの返し方（`isError` と対処のヒント）
- [x] 個人情報フィルタ（緯度・経度・IP を既定で除外、従業員情報の最小化）
- [x] `get_my_profile`

## T7. 参照系ツール
- [x] `get_today_status`
- [x] `get_stamps`（期間の自動分割）
- [x] `get_working_records`（31 日ごとに自動分割）
- [x] `get_alerts`
- [x] `list_projects` / `list_tasks` / `get_my_projects` / `get_manhours`

## T8. 書き込み系ツール
- [x] `punch`（種別必須、その日の打刻履歴との矛盾チェック、`force`、テレワーク）
- [x] `save_manhours` / `delete_manhours`
- [x] `CONFIRM_WRITES=true` 時の Elicitation による確認

## T9. 管理者向けツール
- [x] `list_staff`（ページ送りを自動化）
- [x] `get_team_stamps`（50 人ごとに分割）
- [x] `get_working_statuses`
- [x] `get_project_members`

## T10. 集計
- [x] `summarize_working_hours`（実働合計、出勤日数、休日出勤日数、法定時間外の目安）

## T11. テストデータと手動 E2E
- [x] 匿名化済みフィクスチャ
- [x] 実環境向けの手動 E2E スクリプト（読み取り系のみ、CI では実行しない）

## T12. リリース
- [x] README の完成（セットアップ、各クライアントの設定例、管理者向けの API 有効化手順、ツール一覧、制約）
- [x] リリース用ワークフロー（Changesets + Trusted Publishing + provenance）。初回の手作業は docs/release.md
- [ ] `server.json` と MCP Registry への公開（server.json とワークフローは作成済み。実際の公開はリリース時。**ユーザー作業**）
- [ ] Public 化の前に docs/ の内容を見直す（**ユーザー作業**）

## v0.1 以降の候補
- [x] 打刻漏れチェック `check_attendance_issues`（夜勤は 16 時間以内なら 1 つの勤務として扱う。範囲の前日の打刻も見る）
- [x] 残業リスク検出 `find_overtime_risks`（管理者向け、月末の着地予測。ここまでの出勤日あたりのペース × 残りの平日。祝日は考慮しない）
- [x] 定型プロンプト（MCP Prompts）: `end_of_day` / `log_manhours` / `monthly_review` / `team_status`。使うツールが公開されているときだけ出す
- [ ] ブラウザモード（申請・スケジュール、API を使えない人向け）— 設計判断が必要なため未着手（要相談）
