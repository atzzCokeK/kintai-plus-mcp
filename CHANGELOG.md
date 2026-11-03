# kintai-plus-mcp

## 名前の変更（1.0.0、未リリース）

0.1.x の次の名前は、1.0.0 で変わります。旧名のエイリアスはありません。

- プロンプト `monthly_review` → `end_of_month`
- ツール `get_working_statuses` → `get_working_treatments`（勤務処理。打刻の `get_today_status` とは別）

## 1.0.0

### Major Changes

- [#36](https://github.com/atzzCokeK/kintai-plus-mcp/pull/36) [`74140de`](https://github.com/atzzCokeK/kintai-plus-mcp/commit/74140de5f4af53f02b1c2bb784f24bd85cf599d9) Thanks [@atzzCokeK](https://github.com/atzzCokeK)! - 1.0.0。この版から、ツール名・引数・プロンプト名を互換性の約束にします。壊す変更はメジャーバージョンで行います。
  
  `close_out` を追加し、1 日または月の残件（打刻漏れ、法定の休憩不足、工数、残業の目安、アラート）を 1 回で返します。ツールの説明を、いつ使うかと日本時間の既定が分かるように見直しました。日をまたぐ勤務の翌朝の退勤・休憩戻を打刻漏れと誤らないようにし、月の振り返りは日本時間の 1 日に逆順の期間を頼みません。
  
  0.1.x からの名前の変更です。旧名では呼べません。
  
  - プロンプト `monthly_review` → `end_of_month`
  - ツール `get_working_statuses` → `get_working_treatments`（勤務処理のラベル。打刻の `get_today_status` とは別）

## 0.1.3

### Patch Changes

- [#33](https://github.com/atzzCokeK/kintai-plus-mcp/pull/33) [`b3bd57e`](https://github.com/atzzCokeK/kintai-plus-mcp/commit/b3bd57e011a2dcd1f7f7ee5b9b3b8ef068879bc4) Thanks [@atzzCokeK](https://github.com/atzzCokeK)! - `login` on a terminal lets you choose the API host with the arrow keys. `atnd.ak4.jp` is highlighted by default; move to `atnd-awj.ak4.jp` with the down arrow and confirm with Enter. `--host` and non-interactive input still accept a host name or URL.

## 0.1.2

### Patch Changes

- [#21](https://github.com/atzzCokeK/kintai-plus-mcp/pull/21) [`eeccc19`](https://github.com/atzzCokeK/kintai-plus-mcp/commit/eeccc197c66324c1e362c05dc99574406009eac7) Thanks [@atzzCokeK](https://github.com/atzzCokeK)! - Rename the `CONFIRM_WRITES` environment variable to `KINTAI_PLUS_CONFIRM_WRITES` to match the other settings. `CONFIRM_WRITES` is still read when the new name is not set.

## 0.1.1

### Patch Changes

- [#17](https://github.com/atzzCokeK/kintai-plus-mcp/pull/17) [`28cf185`](https://github.com/atzzCokeK/kintai-plus-mcp/commit/28cf18571dfb5e27c87c6b150e6e42231a51e1ef) Thanks [@atzzCokeK](https://github.com/atzzCokeK)! - Stop reporting missing punches when the working record already has that time, and lower the severity of a long day when break time is unknown. Do not store or reissue a token passed by environment variable unless KINTAI_PLUS_PERSIST_ENV_TOKEN=true. Reject unknown tool arguments and months outside 01–12, and explain unknown staff IDs instead of passing through 「従業員IDは必ず入力してください」.

## 0.1.0

### Minor Changes

- [#13](https://github.com/atzzCokeK/kintai-plus-mcp/pull/13) [`61c65e4`](https://github.com/atzzCokeK/kintai-plus-mcp/commit/61c65e49dbd173ccc54cb0f9236cd3ddb0584456) Thanks [@atzzCokeK](https://github.com/atzzCokeK)! - Add `check_attendance_issues` to find missing punches, unended breaks, long days, short rest intervals, and holiday work.

- [#13](https://github.com/atzzCokeK/kintai-plus-mcp/pull/13) [`457d5fb`](https://github.com/atzzCokeK/kintai-plus-mcp/commit/457d5fba3ee790dad9bbba90c785bab0b60a478b) Thanks [@atzzCokeK](https://github.com/atzzCokeK)! - Add `find_overtime_risks` (admin) to project each staff member's monthly overtime estimate to the month end.

- [#12](https://github.com/atzzCokeK/kintai-plus-mcp/pull/12) [`c2d7fe9`](https://github.com/atzzCokeK/kintai-plus-mcp/commit/c2d7fe94cf2713856b4d1521942b544d1df15185) Thanks [@atzzCokeK](https://github.com/atzzCokeK)! - Initial release: MCP server for the マネーフォワード クラウド勤怠Plus public API with login/logout/status CLI, automatic token refresh, punch and man-hour tools with safety checks, read tools for punches, working records, alerts, projects and man-hours, working-hours summary with an overtime estimate, and admin tools.

- [#13](https://github.com/atzzCokeK/kintai-plus-mcp/pull/13) [`4d10f43`](https://github.com/atzzCokeK/kintai-plus-mcp/commit/4d10f439a34616d40396483f2ea78887e57c23d8) Thanks [@atzzCokeK](https://github.com/atzzCokeK)! - Add MCP prompts: `end_of_day`, `log_manhours`, `monthly_review`, and `team_status` (admin).

### Patch Changes

- [#16](https://github.com/atzzCokeK/kintai-plus-mcp/pull/16) [`772d894`](https://github.com/atzzCokeK/kintai-plus-mcp/commit/772d89476833a30c655a24f9ec11e1a123614422) Thanks [@atzzCokeK](https://github.com/atzzCokeK)! - Match the public API's observed errors, envelopes, and working records. Invalid tokens are reported as auth failures, a company-id mismatch is called out, zero visible projects and a page past the end are empty results, and working minutes are estimated from start and end when the API omits them.
