import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 実際のプロセスを stdio で起動して、MCP として応答することを確かめる */
async function runServer(messages: object[]): Promise<{ stdout: string; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'kintai-plus-mcp-stdio-'));
  try {
    const child = spawn(process.execPath, ['src/cli.ts'], {
      env: { ...process.env, KINTAI_PLUS_CREDENTIALS_FILE: join(dir, 'none.json') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
    // 全リクエストに応答が来たら stdin を閉じる（閉じるとサーバーは終了する）
    const expected = messages.filter((m) => 'id' in m).length;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout; stderr: ${stderr}`)), 15_000);
      const check = () => {
        if (stdout.split('\n').filter(Boolean).length >= expected) {
          clearTimeout(timer);
          child.stdin.end();
          resolve();
        }
      };
      child.stdout.on('data', check);
    });
    await new Promise((resolve) => child.on('exit', resolve));
    return { stdout, stderr };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('stdio server', () => {
  it('initialize と tools/list に応答し、stdout には JSON-RPC だけを書く', async () => {
    const { stdout, stderr } = await runServer([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '0' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(lines.every((l) => l.jsonrpc === '2.0')).toBe(true);
    expect(lines[0].result.serverInfo.name).toBe('kintai-plus-mcp');
    expect(lines[1].result.tools.map((t: { name: string }) => t.name)).toContain('get_my_profile');
    expect(stderr).toMatch(/login/); // 未ログインの案内はログ（stderr）に出る
  }, 20_000);
});
