# クラウド勤怠Plus 公開 API メモ

一次情報: [マネーフォワード クラウド勤怠Plus 公開API 仕様](https://akashi.zendesk.com/hc/ja/articles/115000475854)
（2026-10-27 に確認。WebFetch は 403 になるため、読むときはブラウザツールを使う。仕様についての問い合わせ先: attendance-plus.feedback@moneyforward.com）

ここには実装に必要な事実だけを要約する。細かい項目は必ず一次情報で確認すること。

## 共通

- ベース URL: `https://atnd.ak4.jp/api/cooperation` または `https://atnd-awj.ak4.jp/api/cooperation`（ログイン後の URL のドメインに合わせる）
- パスに企業 ID（「ログイン企業ID」）を含む: `/{companyId}/stamps` など。例外: トークン再発行は `/token/reissue/{companyId}`、勤務処理は `/working_statuses/search`（企業 ID はボディ）
- 認証: アクセストークン。GET はクエリ `?token=`、POST はボディの `token`。**URL にトークンが載るので、ログ・エラーから必ず除去する**
- レスポンス: 成功 `{ success: true, response: {...} }`、失敗 `{ success: false, errors: [{ code, message }] }`
- 値なし: String/Integer/Object は `null`、Array は `[]`、Boolean は必ず true/false
- レート制限: 記載なし（控えめにスロットリングする）
- OpenAPI 定義: なし
- 権限: 各 API はトークンの持ち主の権限で許可・却下される。`permissionType`: 1=企業管理者、2=一般管理者、3=従業員

## トークン

- 発行: 管理者が従業員設定 > 変更 > 利用機能設定 で「公開API利用可否」を「利用する」にすると、その従業員のマイページに「APIトークン」メニューが出て、本人が発行する
- 有効期限: **1 ヶ月と 1 日**
- 再発行: `POST /token/reissue/{companyId}` ボディ `{ token }` → `response: { login_company_code, staff_id, token, expired_at: "yyyy/mm/dd HH:MM:SS" }`。再発行時、期限切れのトークンは自動削除される（有効な旧トークンが即失効するかは未確認）

## 日時の形式（API ごとに違うので注意）

- 打刻取得の期間: `yyyymmddHHMMSS`
- 勤務実績の期間: `yyyymmdd`
- 打刻実行の `stampedAt`: `YYYY/MM/DD HH:MM:SS`、`timezone`: `+09:00`
- レスポンスの日時: `yyyy/mm/dd HH:MM:SS`、日付: `yyyy/mm/dd`
- プロジェクト・工数: `yyyy/mm/dd`、勤務処理: `YYYY-MM-DD`

## 使う API（v1）

| 用途 | メソッド・パス | 制約・メモ |
|---|---|---|
| 従業員取得 | `GET /{c}/staffs`（自分）、`/{c}/staffs/{staffId}`、`?page=n` | 管理下の一覧は 20 人/ページ、page は 0 始まり、`TotalCount` を参照。項目: staffId, email, 姓名・カナ, organization, subgroups, employmentCategory, staffNum, permissionGroup{permissionType}, managedOrganizations など |
| 打刻実行 | `POST /{c}/stamps` | `type`: 11 出勤 / 12 退勤 / 21 直行 / 22 直帰 / 31 休憩入 / 32 休憩戻。省略すると履歴から出勤・退勤を自動判定（**使わない**）。`telework: 1` は出勤時のみ有効。**記録はサーバー到着時刻**で、過去時刻での打刻・修正はできない |
| 打刻取得 | `GET /{c}/stamps`（自分）、`/{c}/stamps/{staffId}` | 期間最長 6 ヶ月、1 回 1000 件まで。項目: stamped_at, type, local_time, timezone, attributes{method, org_id, workplace_id, latitude, longitude, ip}（**位置・IP は既定で除外**） |
| 複数従業員の打刻 | `GET /{c}/multiple_stamps?staff_ids=1,2,3` | 期間最長 **1 日**、最大 50 人、1000 件まで |
| アラート取得 | `GET /{c}/alerts` | 本人分のみ、絞り込み不可。項目: month, date, alert_type（1 打刻忘れ, 2 欠勤疑い, 3 休憩過小/超過, 6 休日出勤, 7 遅刻, 8 早退, 9 残業時間閾値超え, 11 深夜労働, 13 36協定, 14 インターバル, 22 工数未入力, 28 休憩時間不足 など 1〜28、23 は欠番） |
| 勤務実績 | `GET /{c}/working_records?staff_ids=...` | 自分と管理下。期間最長 **31 日**。項目: date, working_day_category（0 労働日 / 1 所定休日 / 2 法定休日）, start_time, end_time, rounded_*, attendance_punch_time, leaving_punch_time, actual_working_hours_no_rounding（分）, break_time_results。**残業時間の項目はない** |
| 勤務処理取得 | `POST /working_statuses/search` | `search: [{ staff_id, date: "YYYY-MM-DD" }]` 最大 1000 件。欠勤・出張などの企業ごとのラベル |
| プロジェクト一覧 | `GET /{c}/projects` | 50 件/ページ。project_id, name, short_name, project_code, start_date, end_date など |
| タスク一覧 | `GET /{c}/{projectId}/tasks` | 50 件/ページ。task_id, name, code, estimated_hour（分）, is_finished など |
| 参加プロジェクト | `GET /{c}/staff_projects/{staffId}` | |
| プロジェクト従業員 | `GET /{c}/project_staffs/{projectId}` | staff_ids, owner_staff_ids |
| 工数取得 | `GET /{c}/manhours`、`/{c}/manhours/{staffId}` | 期間省略時は当月。dates[].projects[].daily_hour_items[{task_id, minute}]、コメント、closed_at / fixed_at（締め・確定） |
| 工数作成更新 | `POST /{c}/manhours` | manhours[{ staff_id, dates[{ date, projects[{ project_id, daily_hour_items[{ task_id, minute }] }] }] }] |
| 工数削除 | `DELETE /{c}/manhours/{staffId}` | date と project_id は必須。task_id を省略するとそのプロジェクトの全タスクの工数を削除 |

## v1 で使わない API

組織作成、従業員の登録・更新（PATCH `/staffs`）・退職/削除（DELETE `/staff/{id}`）、個別就業設定、異動、権限と管理先の指定・予約、勤務処理更新、プロジェクト・タスクの作成・削除、プロジェクト従業員の追加・解除。

## API にない機能

申請（残業・予定変更・実績変更・休暇休日・直行直帰など）、スケジュール、打刻の修正・削除。

## 未確認事項（実装での仮定。手元の E2E で確認する）

一次情報がこの開発環境から読めなかったため、以下は仮定で実装している。確認したらここを更新する。

- HTTP ステータス: 失敗時に 4xx/5xx を返すのか、常に 200 で `success: false` なのか。実装は両方に対応（`src/api/errors.ts`）。200 でエラーコード・メッセージに「token/トークン/認証」を含むものは認証エラー扱い
- エラーコードの一覧と形式（文字列か数値か）
- DELETE（工数削除）でのトークンと条件の渡し方。実装はクエリに載せている
- 打刻取得・勤務実績の期間パラメータ名（`start_date` / `end_date` を想定）
- 従業員一覧の `TotalCount` のキー名と位置（`response` 直下を想定。`total_count` / `totalCount` も読む）
- 各 API の応答の包み方（`{ stamps: [...] }` か配列か、従業員ごとに包むか）。パーサーはどちらも読む（`src/api/*.ts`）
- 従業員取得のキー名（camelCase を想定し snake_case も読む）。氏名は `lastName` + `firstName` を想定
- プロジェクト一覧・タスク一覧の `page` が 0 始まりか（従業員一覧に合わせて 0 始まりと仮定）
- 工数取得の期間パラメータ名と上限（`start_date` / `end_date`、`yyyy/mm/dd` と仮定。31 日ごとに分割している）
- 勤務実績の `staff_ids` に指定できる人数の上限（50 人ずつに分けている）
- 勤務実績の `break_time_results` の形（開始・終了の組、または分数を想定）。時刻項目が「HH:MM」だけの場合（24 時以降を含む）にも対応
- 参加プロジェクト API（`staff_projects`）の応答（ID の配列か、プロジェクトの配列か）
