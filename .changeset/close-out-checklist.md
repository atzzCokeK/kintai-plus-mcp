---
"kintai-plus-mcp": minor
---

Add read-only `close_out` (scope day or month) so one call lists what is still unfinished: missing punches, breaks shorter than the Labor Standards Act requires, man-hours that are missing or off, the month's overtime estimate, and alerts. Each item includes the date and the next action. `end_of_day` and `monthly_review` now call it. Tool descriptions say when to use each tool, Japan-time defaults, and that punches cannot be undone. Successful results also include structuredContent; `close_out` publishes an output schema.
