#!/usr/bin/env node
import { VERSION } from './version.ts';

// T4 で CLI を実装するまでの仮のエントリーポイント。stdout は MCP の通信路なので stderr に出す。
process.stderr.write(`kintai-plus-mcp ${VERSION}\n`);
