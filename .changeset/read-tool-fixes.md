---
"kintai-plus-mcp": patch
---

Stop reporting missing punches when the working record already has that time, and lower the severity of a long day when break time is unknown. Do not store or reissue a token passed by environment variable unless KINTAI_PLUS_PERSIST_ENV_TOKEN=true. Reject unknown tool arguments and months outside 01–12, and explain unknown staff IDs instead of passing through 「従業員IDは必ず入力してください」.
