# kintai-plus-mcp

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
