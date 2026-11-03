# 0010. 確認は3段階にし、MCP の注釈とリソースで同じ情報を渡す

- 日付: 2026-11-03
- 状態: 採用

## 背景

- 1.0 の既定は確認なしだった（ADR 0005）。打刻の誤操作は矛盾チェックでかなり防げるが、工数の削除は取り消す操作なので、既定でも一度止めた方がよい。
- 毎回の確認は打刻には重い。クライアントによって Elicitation の有無が違う。
- ツール注釈（読み取り、破壊的、冪等、外部）とリソースは、対応クライアントが確認の出し分けやコンテキストの添付に使う。リソースだけにしか無い情報は、未対応クライアントから取れなくなる。

## 決定

- 確認レベルは `always`（すべての書き込み）、`destructive`（削除だけ。既定）、`never`（確認しない）。
- `destructive` の対象は `destructive: true` のツールだけにする。今は `delete_manhours` だけ。打刻と工数の保存は destructive ではない。
- 対話の `login` で矢印選択し、`settings.json` に保存する。`KINTAI_PLUS_CONFIRM` が最優先。旧い真偽値の環境変数は、新しい名前が無いときだけ読む。
- Elicitation（form）を宣言したクライアントには `elicitation/create` で、何をいつ書くかを示して承認をもらう。decline / cancel は実行しない。未対応のクライアントは任意引数 `confirm: true` まで実行せず、プレビューを返す。
- 全ツールに `title` と `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` を付ける。
- `kintai://today`、`kintai://close-out/month`、`kintai://guide` は、それぞれ `get_today_status`、今月の `close_out`、`get_attendance_guide` と同じ内容にする。
- 成功したオブジェクトは `structuredContent` と、同じ JSON のテキストの両方で返す。

## 結果

- 打刻の矛盾チェックと `force`、読み取り専用モードは ADR 0005 のまま。確認レベルはそれに足す。
- ツール名・既存の引数・プロンプト名は変えない。`confirm` は任意引数として書き込みツールに足す。
