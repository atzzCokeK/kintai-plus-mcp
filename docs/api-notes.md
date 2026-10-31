# クラウド勤怠Plus 公開 API メモ

一次情報: [マネーフォワード クラウド勤怠Plus 公開API 仕様](https://akashi.zendesk.com/hc/ja/articles/115000475854)
（仕様の文章は公式ヘルプで確認した。応答の形は、自分の API トークンを使った読み取り専用の呼び出しで確認した。仕様についての問い合わせ先: attendance-plus.feedback@moneyforward.com）

ここには実装に必要な事実だけを要約する。細かい項目は必ず一次情報で確認すること。

## 共通

- ベース URL: `https://atnd.ak4.jp/api/cooperation` または `https://atnd-awj.ak4.jp/api/cooperation`（ログイン後の URL のドメインに合わせる）
- パスに企業 ID（「ログイン企業ID」）を含む: `/{companyId}/stamps` など。例外: トークン再発行は `/token/reissue/{companyId}`、勤務処理は `/working_statuses/search`（企業 ID はボディ）
- 認証: アクセストークン。GET はクエリ `?token=`、POST はボディの `token`。**URL にトークンが載るので、ログ・エラーから必ず除去する**
- レスポンス: 成功は多くの API で `{ success: true, response: {...} }`。勤務処理取得だけ `response` が無く `{ success: true, results: [...], errors: [] }`。失敗は HTTP 4xx と `{ success: false, errors: [{ code, message }] }`（`errors` は複数入ることがある。`code` は `"ERR300002"` のような文字列）。観測した範囲では、失敗が HTTP 200 の `success: false` になることはなかった。実装はコードを HTTP ステータスより先に分類する（`src/api/errors.ts`）
- 値なし: String/Integer/Object は `null`、Array は `[]`、Boolean は必ず true/false
- レート制限: 記載なし（控えめにスロットリングする）
- OpenAPI 定義: なし
- 権限: 各 API はトークンの持ち主の権限で許可・却下される。`permissionType`: 1=企業管理者、2=一般管理者、3=従業員

## トークン

- 発行: 管理者が従業員設定 > 変更 > 利用機能設定 で「公開API利用可否」を「利用する」にすると、その従業員のマイページに「APIトークン」メニューが出て、本人が発行する
- 有効期限: **1 ヶ月と 1 日**
- 再発行: `POST /token/reissue/{companyId}` ボディ `{ token }` → `response: { login_company_code, staff_id, token, expired_at: "yyyy/mm/dd HH:MM:SS" }`。再発行すると、その呼び出しに使ったトークンは使えなくなる。期限切れのトークンは再発行時に削除される

## 日時の形式（API ごとに違うので注意）

- 打刻取得の期間: `yyyymmddHHMMSS`
- 勤務実績の期間: `yyyymmdd`
- 打刻実行の `stampedAt`: `YYYY/MM/DD HH:MM:SS`。仕様の `timezone` は `+09:00`。取得応答の `timezone` は `+9.00`（時が 1 桁で、区切りが `.`）。読み取りはどちらも受け付ける。打刻実行の送信は `+09:00`
- レスポンスの日時: `yyyy/mm/dd HH:MM:SS`、日付: `yyyy/mm/dd`
- プロジェクト・工数: `yyyy/mm/dd`、勤務処理: `YYYY-MM-DD`

## 使う API（v1）

| 用途 | メソッド・パス | 制約・メモ |
|---|---|---|
| 従業員取得 | `GET /{c}/staffs`（一覧）、`/{c}/staffs/{staffId}`、`?page=n` | 管理下の一覧は 20 人/ページ。page は 0 始まりで、page を付けない GET は page 0 と同じ（管理者には一覧が返る）。範囲外の page は空配列ではなく 404 `ERR300602`。`TotalCount` は `response.TotalCount`（`Count` と `login_company_code` と並ぶ）。氏名は `lastName` / `firstName`。ネストは `organization.Name`, `permissionGroup.Name`, `Subgroups`, `Tag`, `Remarks`。自分の staffId は `GET /stamps` の `staff_id` でも取れる |
| 打刻実行 | `POST /{c}/stamps` | `type`: 11 出勤 / 12 退勤 / 21 直行 / 22 直帰 / 31 休憩入 / 32 休憩戻。省略すると履歴から出勤・退勤を自動判定（**使わない**）。`telework: 1` は出勤時のみ有効。**記録はサーバー到着時刻**で、過去時刻での打刻・修正はできない |
| 打刻取得 | `GET /{c}/stamps`（自分）、`/{c}/stamps/{staffId}` | 期間最長 6 ヶ月、1 回 1000 件まで。`start_date` / `end_date` は `yyyymmddHHMMSS`。応答は `{ login_company_code, staff_id, count, stamps: [...] }`。項目: stamped_at, type, local_time, timezone（`+9.00`）, attributes{method, org_id, workplace_id, latitude, longitude, ip}（**位置・IP は実データにあり、既定で除外**） |
| 複数従業員の打刻 | `GET /{c}/multiple_stamps?staff_ids=1,2,3` | 期間最長 **1 日**、最大 50 人、1000 件まで。応答は `{ login_company_code, multiple_stamps: [{ staff_id, count, stamps }] }` |
| アラート取得 | `GET /{c}/alerts` | 本人分のみ、絞り込み不可。応答は `{ ..., count, alerts: [{ month, date, alert_type }] }`。alert_type: 1 打刻忘れ, 2 欠勤疑い, 3 休憩過小/超過, 6 休日出勤, 7 遅刻, 8 早退, 9 残業時間閾値超え, 11 深夜労働, 13 36協定, 14 インターバル, 22 工数未入力, 28 休憩時間不足 など 1〜28、23 は欠番 |
| 勤務実績 | `GET /{c}/working_records?staff_ids=...` | 自分と管理下。`start_date` / `end_date` は `yyyymmdd`、最長 **31 日**（超えると 400 `ERR301601`。`staff_ids` が無いと 400 `ERR301603`）。`response` は `[{ staff_id, working_records: [...] }]`。各レコードの項目は date, working_day_category（0 労働日 / 1 所定休日 / 2 法定休日）, start_time, end_time, rounded_*, attendance_punch_time, leaving_punch_time のみ。時刻は `yyyy/mm/dd HH:MM:SS` で、終了が翌日以降になる夜勤がある。`actual_working_hours_no_rounding` と `break_time_results` は返らない。実働は開始〜終了（無ければ rounded_*）の経過として見積もり、休憩は不明とする。**残業時間の項目はない** |
| 勤務処理取得 | `POST /working_statuses/search` | ボディは `{ login_company_code, token, search: [{ staff_id, date: "YYYY-MM-DD" }] }`、最大 1000 件。成功は `{ success: true, results: [{ staff_id: "1002"（文字列）, date, working_statuses: [] }], errors: [] }` で `response` は無い。`working_statuses` の中身（ラベルの置き場所）は未確認 |
| プロジェクト一覧 | `GET /{c}/projects` | 50 件/ページ。見えるプロジェクトが 0 件のときは 404 `ERR301900`（空の一覧として扱う）。project_id, name, short_name, project_code, start_date, end_date など |
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

## エラーコード（2026-10-29 に観測）

失敗は HTTP 4xx と `{ success: false, errors: [{ code, message }] }`。`code` は文字列。複数のエラーが一度に返ることがある（開始日と終了日の両方に `ERR301001` など）。分類はコードを先に見る。

| code | HTTP | 観測した意味 | このサーバーでの扱い |
|---|---|---|---|
| `ERR300002` | 404 | 指定されたトークンは無効です。 | 認証エラー。マイページでの再発行を案内する |
| `ERR300001` | 404 | 指定された企業は存在しません。 | ログイン企業ID の設定ミスとして案内する |
| `ERR301001` | 404 | 日付が無い、または不正 | `invalid_request` |
| `ERR300602` | 404 | ページが範囲外 | ページ送りの終端（空の続き）。利用者にはエラーにしない |
| `ERR301900` | 404 | 見えるプロジェクトが 0 件 | `list_projects` / `list_tasks` / `get_my_projects` などは空の一覧 |
| `ERR301603` | 400 | `working_records` に `staff_ids` が無い | `invalid_request` |
| `ERR301601` | 400 | `working_records` の期間が 31 日を超える | `invalid_request` |

メッセージに token / トークン / 認証 を含むものも認証エラーにする。コードの一覧はこの表がすべてではない。

## 未確認事項

2026-10-29 の読み取り調査で、上の表と各 API の項に書いた形は確認した。次はまだ仮定のまま動いている。必要なら `pnpm e2e --record` で確認する。

- DELETE（工数削除）でのトークンと条件の渡し方。実装はクエリに載せている
- 工数取得の期間パラメータが効くか、上限は何か（`start_date` / `end_date`、`yyyy/mm/dd` と仮定。31 日ごとに分割している）
- 参加プロジェクト API（`staff_projects`）の要素の形（ID の配列か、プロジェクトの配列か）
- プロジェクト一覧・タスク一覧の `page` が 0 始まりか（従業員一覧に合わせて 0 始まりと仮定）
- 勤務実績の `staff_ids` の上限（3 人までは成功した。上限は不明なので 50 人ずつに分けている）
- 勤務処理の `working_statuses` 配列の中身（ラベルの置き場所）。空配列しか見ていない
