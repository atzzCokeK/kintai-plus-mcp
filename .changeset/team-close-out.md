---
"kintai-plus-mcp": minor
---

管理者向けに `team_close_out` とプロンプト `team_end_of_month` を追加し、管理下の 1 日または月の残件を 1 回で返す。`get_working_records` に任意の `staffIds` を追加した。過去日の退勤漏れは日末まで数えず、休憩実績か法定の最低休憩を引いた見積もりを残業の目安に使う。
