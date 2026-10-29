import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/runtime.ts';
import { buildServerSetup } from '../../src/server/start.ts';
import { fixtureApi } from '../helpers/fixture-api.ts';
import { connectTestClient } from '../helpers/mcp-client.ts';

/**
 * 架空のフィクスチャを返す偽 API に対して、サーバー全体（起動・権限判定・各ツール）を通しで動かす。
 * 「今」は 2026-10-27 13:30 JST に固定する。
 */
const TOKEN = 'fixture-token-0000000001';
const NOW = new Date('2026-10-27T13:30:00+09:00');

let dir: string;
let client: Awaited<ReturnType<typeof connectTestClient>>;
let api: ReturnType<typeof fixtureApi>;
let toolNames: string[];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kintai-plus-mcp-fixtures-'));
  const file = join(dir, 'credentials.json');
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      host: 'atnd.ak4.jp',
      companyId: 'example-co',
      token: TOKEN,
      staffId: 1001,
      expiresAt: '2026-11-25T00:00:00.000Z',
      updatedAt: '2026-10-25T00:00:00.000Z',
    }),
    { mode: 0o600 },
  );
  api = fixtureApi({ token: TOKEN });
  const runtime = await createRuntime({
    env: {
      KINTAI_PLUS_CREDENTIALS_FILE: file,
      KINTAI_PLUS_MIN_INTERVAL_MS: '100',
      KINTAI_PLUS_LOG_LEVEL: 'silent',
    },
    fetch: api.fetch,
    now: () => NOW,
  });
  const setup = await buildServerSetup(runtime, { now: () => NOW });
  toolNames = setup.tools.map((t) => t.name);
  client = await connectTestClient(setup.createServer());
});

afterAll(async () => {
  await client?.close();
  await rm(dir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool(name, args);
  expect(res.text).not.toContain(TOKEN);
  return res;
}

describe('フィクスチャでの通しの動作', () => {
  it('一般管理者にはすべてのツールを公開する', async () => {
    expect(toolNames).toHaveLength(19);
    expect((await client.listTools()).map((t) => t.name)).toEqual(toolNames);
  });

  it('定型プロンプトも公開する', async () => {
    const res = (await client.request('prompts/list')).result as {
      prompts: Array<{ name: string }>;
    };
    expect(res.prompts.map((p) => p.name)).toEqual([
      'end_of_day',
      'log_manhours',
      'monthly_review',
      'team_status',
    ]);
  });

  it('get_my_profile', async () => {
    const res = await call('get_my_profile');
    expect(res.json).toMatchObject({
      staffId: 1001,
      name: '架空 花子',
      organizationName: '開発部',
      role: 'admin',
      today: '2026-10-27',
    });
    expect(res.text).not.toContain('@example.com');
  });

  it('get_today_status: 休憩から戻って勤務中', async () => {
    const res = await call('get_today_status');
    expect(res.json).toMatchObject({ state: 'working', workedMinutes: 213, breakMinutes: 58 });
  });

  it('get_stamps: 位置情報と IP は返さない', async () => {
    const res = await call('get_stamps');
    expect(res.json).toMatchObject({ count: 3 });
    expect(res.text).not.toMatch(/latitude|longitude|192\.0\.2/);
  });

  it('get_working_records と summarize_working_hours', async () => {
    const records = await call('get_working_records', { from: '2026-10-01', to: '2026-10-04' });
    expect(records.json).toMatchObject({
      count: 4,
      records: expect.arrayContaining([
        expect.objectContaining({
          date: '2026-10-01',
          actualWorkingMinutes: 630,
          actualWorkingMinutesEstimated: true,
          breakTime: 'unknown',
        }),
      ]),
    });
    const summary = await call('summarize_working_hours', { from: '2026-10-01', to: '2026-10-04' });
    expect(summary.json).toMatchObject({
      totalWorkingMinutes: 1350,
      workDays: 3,
      holidayWorkDays: 1,
      legalHolidayWorkDays: 1,
      estimatedOvertimeMinutes: 390,
      breakTimeUnknown: true,
    });
    expect(summary.text).toContain('目安');
    expect(summary.text).toContain('休憩');
  });

  it('check_attendance_issues: 法定休日の出勤を情報として出す', async () => {
    const res = await call('check_attendance_issues', { from: '2026-10-01', to: '2026-10-04' });
    expect(res.isError).toBe(false);
    expect(res.text).toContain('holiday_work');
  });

  it('get_alerts', async () => {
    const res = await call('get_alerts', { month: '2026-10' });
    expect(res.json).toMatchObject({ count: 2 });
    expect(res.text).toContain('休日出勤');
  });

  it('プロジェクト・タスク・工数', async () => {
    expect((await call('list_projects', { activeOn: '2026-10-27' })).json).toMatchObject({
      count: 2,
    });
    expect((await call('list_tasks', { projectId: 501 })).json).toMatchObject({ count: 2 });
    expect((await call('get_my_projects')).text).toContain('架空商事向け開発');
    const manhours = await call('get_manhours', { from: '2026-10-01', to: '2026-10-02' });
    expect(manhours.json).toMatchObject({ totalMinutes: 510 });
    expect(manhours.text).toContain('設計');
  });

  it('管理者向け: list_staff はメールを返さない', async () => {
    const res = await call('list_staff');
    expect(res.json).toMatchObject({ totalCount: 3, count: 3 });
    expect(res.text).toContain('開発部');
    expect(res.text).not.toContain('@example.com');
  });

  it('管理者向け: get_team_stamps', async () => {
    const res = await call('get_team_stamps');
    expect(res.json).toMatchObject({
      summary: { working: 1, on_break: 1, not_started: 1, finished: 0 },
    });
    expect(res.text).not.toContain('192.0.2');
  });

  it('管理者向け: get_working_statuses と get_project_members', async () => {
    expect((await call('get_working_statuses')).text).toContain('出張');
    expect((await call('get_project_members', { projectId: 501 })).json).toMatchObject({
      count: 2,
    });
  });

  it('punch: 勤務中の出勤は拒否し、休憩入は打刻する', async () => {
    const refused = await call('punch', { type: 'clock_in' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/force/);
    const before = api.requests.filter(
      (r) => r.method === 'POST' && r.path.endsWith('/stamps'),
    ).length;
    expect(before).toBe(0);
    const ok = await call('punch', { type: 'break_start' });
    expect(ok.json).toMatchObject({ punched: 'break_start', newState: 'on_break' });
    const posts = api.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/stamps'));
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ type: 31, timezone: '+09:00' });
  });

  it('save_manhours / delete_manhours', async () => {
    const saved = await call('save_manhours', {
      date: '2026-10-01',
      entries: [{ projectId: 501, taskId: 9001, minutes: 300 }],
    });
    expect(saved.isError).toBe(false);
    const post = api.requests.find((r) => r.method === 'POST' && r.path.endsWith('/manhours'));
    // 同じプロジェクトの別タスク（9002）は保ったまま送る
    expect(JSON.stringify(post?.body)).toContain('"task_id":9002');
    const deleted = await call('delete_manhours', { date: '2026-10-01', projectId: 502 });
    expect(deleted.json).toMatchObject({ deleted: true });
  });
});
