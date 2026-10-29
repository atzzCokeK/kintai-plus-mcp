---
"kintai-plus-mcp": patch
---

Match the public API's observed errors, envelopes, and working records. Invalid tokens are reported as auth failures, a company-id mismatch is called out, zero visible projects and a page past the end are empty results, and working minutes are estimated from start and end when the API omits them.
