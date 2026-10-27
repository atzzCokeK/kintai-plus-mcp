import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/runtime.ts';
import { buildServerSetup } from '../../src/server/start.ts';
import { connectTestClient } from '../helpers/mcp-client.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kintai-plus-mcp-start-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function runtimeWith(permissionType: number | undefined, env: Record<string, string> = {}) {
  const file = join(dir, 'credentials.json');
  if (permissionType !== undefined) {
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        host: 'atnd.ak4.jp',
        companyId: 'acme',
        token: 'stored-token-123456',
        expiresAt: '2026-12-31T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      }),
      { mode: 0o600 },
    );
  }
  const logs: string[] = [];
  const runtime = await createRuntime({
    env: { KINTAI_PLUS_CREDENTIALS_FILE: file, KINTAI_PLUS_MIN_INTERVAL_MS: '100', ...env },
    now: () => new Date('2026-10-27T00:00:00Z'),
    fetch: async () =>
      Response.json({
        success: true,
        response: { staffId: 7, permissionGroup: { permissionType } },
      }),
    writeLog: (s) => logs.push(s),
  });
  return { runtime, logs };
}

describe('buildServerSetup', () => {
  it('起動時に権限を確認し、従業員には管理者向けツールを出さない', async () => {
    const { runtime } = await runtimeWith(3);
    const setup = await buildServerSetup(runtime);
    expect(setup.role).toBe('employee');
    expect(setup.tools.every((t) => t.audience === 'everyone')).toBe(true);
    expect(setup.tools.map((t) => t.name)).toContain('get_my_profile');
    expect(setup.tools.map((t) => t.name)).not.toContain('list_staff');
  });

  it('読み取り専用モードでは書き込みツールを出さない', async () => {
    const { runtime } = await runtimeWith(1, { KINTAI_PLUS_READ_ONLY: 'true' });
    const setup = await buildServerSetup(runtime);
    expect(setup.tools.some((t) => t.kind === 'write')).toBe(false);
    expect(setup.tools.map((t) => t.name)).toContain('list_staff');
  });

  it('未ログインでも起動でき、ツールは login を案内する', async () => {
    const { runtime, logs } = await runtimeWith(undefined);
    const setup = await buildServerSetup(runtime);
    expect(setup.role).toBe('employee');
    expect(logs.join('')).toMatch(/login/);
    const client = await connectTestClient(setup.createServer());
    const res = await client.callTool('get_my_profile');
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/npx kintai-plus-mcp login/);
    await client.close();
  });

  it('接続ごとに新しいサーバーを作れる（serveStdio のファクトリ）', async () => {
    const { runtime } = await runtimeWith(1);
    const setup = await buildServerSetup(runtime);
    expect(setup.role).toBe('company_admin');
    expect(setup.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['list_staff', 'get_team_stamps']),
    );
    expect(setup.createServer()).not.toBe(setup.createServer());
  });
});
