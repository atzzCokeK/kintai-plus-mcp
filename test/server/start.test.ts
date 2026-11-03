import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/runtime.ts';
import { buildServerSetup } from '../../src/server/start.ts';
import { ALL_TOOLS } from '../../src/tools/index.ts';
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

  it('権限確認に失敗しても起動し、従業員向けだけを出す。ログにトークンは出ない', async () => {
    const file = join(dir, 'credentials.json');
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
    const logs: string[] = [];
    const runtime = await createRuntime({
      env: { KINTAI_PLUS_CREDENTIALS_FILE: file, KINTAI_PLUS_MIN_INTERVAL_MS: '100' },
      now: () => new Date('2026-10-27T00:00:00Z'),
      fetch: async () => Response.json({ success: false, errors: [] }, { status: 500 }),
      writeLog: (s) => logs.push(s),
    });
    const setup = await buildServerSetup(runtime);
    expect(setup.role).toBe('employee');
    expect(setup.tools.some((t) => t.audience === 'admin')).toBe(false);
    expect(logs.join('')).toMatch(/permission/i);
    expect(logs.join('')).not.toContain('stored-token-123456');
  });

  it('権限と読み取り専用で、MCP に出すツールとプロンプトが変わる', async () => {
    const cases = [
      { permission: 3, env: {}, role: 'employee', readOnly: false },
      { permission: 2, env: {}, role: 'admin', readOnly: false },
      { permission: 1, env: {}, role: 'company_admin', readOnly: false },
      { permission: 3, env: { KINTAI_PLUS_READ_ONLY: 'true' }, role: 'employee', readOnly: true },
      { permission: 2, env: { KINTAI_PLUS_READ_ONLY: 'true' }, role: 'admin', readOnly: true },
    ] as const;
    for (const c of cases) {
      const { runtime } = await runtimeWith(c.permission, { ...c.env });
      const setup = await buildServerSetup(runtime);
      const client = await connectTestClient(setup.createServer());
      const tools = await client.listTools();
      const names = tools.map((t) => t.name);
      const prompts = (
        (await client.request('prompts/list')).result as { prompts: Array<{ name: string }> }
      ).prompts.map((p) => p.name);
      await client.close();

      expect(setup.role).toBe(c.role);
      expect(names).toEqual(
        ALL_TOOLS.filter(
          (t) =>
            (t.audience === 'everyone' || c.role !== 'employee') &&
            (t.kind === 'read' || !c.readOnly),
        ).map((t) => t.name),
      );
      expect(names.includes('punch')).toBe(!c.readOnly);
      expect(names.includes('save_manhours')).toBe(!c.readOnly);
      expect(names.includes('delete_manhours')).toBe(!c.readOnly);
      expect(names.includes('list_staff')).toBe(c.role !== 'employee');
      if (!c.readOnly) {
        expect(tools.find((t) => t.name === 'punch')?.annotations).toEqual({
          title: 'Punch the time clock',
          destructiveHint: false,
          readOnlyHint: false,
          idempotentHint: false,
          openWorldHint: true,
        });
      }
      expect(prompts.includes('end_of_month')).toBe(true);
      expect(prompts.includes('end_of_day')).toBe(!c.readOnly);
      expect(prompts.includes('log_manhours')).toBe(!c.readOnly);
      expect(prompts.includes('team_status')).toBe(c.role !== 'employee');
      expect(prompts.includes('team_end_of_month')).toBe(c.role !== 'employee');
    }
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
