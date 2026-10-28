# kintai-plus-mcp

> **非公式** の MCP サーバーです。株式会社マネーフォワードとは関係がなく、同社による確認・保証は受けていません。
> 「マネーフォワード クラウド勤怠Plus」「AKASHI」などの名称・商標は、それぞれの権利者に帰属します。

[マネーフォワード クラウド勤怠Plus](https://biz.moneyforward.com/attendance-plus/)（旧 AKASHI）の公開 API を、Claude などの AI アシスタントから使えるようにする [Model Context Protocol](https://modelcontextprotocol.io) サーバーです。

> 開発中です（v0.1.0 未リリース）。

## できること

- 打刻（出勤・退勤・休憩など）と、今日の勤務状況の確認
- 打刻履歴・勤務実績・アラートの参照
- 工数の参照・登録・削除
- 勤務時間の集計（法定時間外の目安を含む）
- 管理者向け: 従業員一覧、部下の打刻・勤務状況の参照

## 必要なもの

- Node.js 22 以上
- クラウド勤怠Plus の API トークン（管理者が「公開API利用可否」を有効にすると、マイページから発行できます）

## セットアップ

<!-- TODO(T12): login コマンド、各クライアントの設定例 -->

## ツール一覧

<!-- TODO(T12) -->

## 制約

<!-- TODO(T12): 申請・スケジュールは非対応、打刻は過去時刻にできない、など -->

## ライセンス

MIT

---

## English

**Unofficial** MCP server for the public API of "Money Forward Cloud Kintai Plus" (formerly AKASHI), a Japanese attendance management service.
This project is not affiliated with, endorsed by, or sponsored by Money Forward, Inc. All trademarks belong to their respective owners.

Status: under development (v0.1.0 not yet released).

- Runs locally over stdio: `npx kintai-plus-mcp`
- Requires Node.js 22+ and an API token issued from your Kintai Plus "My Page"
- License: MIT
