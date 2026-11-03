import { describe, expect, it } from 'vitest';
import { STAMP_TYPE_CODES, type Stamp } from '../../src/api/stamps.ts';
import { ALL_CAPABILITIES } from '../../src/backend/types.ts';
import type { TeamCloseoutReport } from '../../src/domain/team-close-out.ts';
import { createMcpServer } from '../../src/server/create-server.ts';
import { ALL_TOOLS } from '../../src/tools/index.ts';
import { annotationsFor, selectTools } from '../../src/tools/registry.ts';
import { teamCloseOutTool, teamCloseoutOutputSchema } from '../../src/tools/team-close-out.ts';
import { fakeBackend, fakeContext } from '../helpers/fake-backend.ts';
import { connectTestClient } from '../helpers/mcp-client.ts';

const NOW = new Date('2026-10-27T03:00:00Z'); // 12:00 JST
const caps = new Set(ALL_CAPABILITIES);

const staff = [
  { staffId: 1, name: '架空 花子', staffNum: 'A001', organizationName: '開発部' },
  { staffId: 2, name: '架空 花子', staffNum: 'A002', organizationName: '開発部' },
];

const clockIn = (staffId: number): Stamp => ({
  staffId,
  type: 'clock_in',
  typeCode: STAMP_TYPE_CODES.clock_in,
  stampedAt: new Date('2026-10-27T00:00:00Z'),
  attributes: {},
});

describe('team_close_out', () => {
  it('一般管理者と企業管理者にだけ公開する', () => {
    expect(teamCloseOutTool.audience).toBe('admin');
    expect(teamCloseOutTool.kind).toBe('read');
    const names = (role: 'employee' | 'admin' | 'company_admin') =>
      selectTools(ALL_TOOLS, { capabilities: caps, role, readOnly: false }).map((t) => t.name);
    expect(names('employee')).not.toContain('team_close_out');
    expect(names('admin')).toContain('team_close_out');
    expect(names('company_admin')).toContain('team_close_out');
  });

  it('読み取り専用・openWorld の注釈と、structuredContent を返す', async () => {
    expect(annotationsFor(teamCloseOutTool)).toEqual({
      title: 'Close out my team for a day or month',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    const backend = fakeBackend({
      listStaff: async () => ({ staff: [], totalCount: 0, truncated: false }),
      getWorkingRecords: async () => [],
    });
    const server = createMcpServer(fakeContext(backend, {}, NOW), [teamCloseOutTool]);
    const client = await connectTestClient(server);
    try {
      const listed = await client.listTools();
      expect(listed[0]?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
      expect(listed[0]?.outputSchema).toMatchObject({ type: 'object' });
      const res = await client.callTool('team_close_out', {});
      expect(res.isError).toBe(false);
      expect(res.structuredContent).toMatchObject({
        staffCount: 0,
        ok: false,
        headline: expect.stringMatching(/従業員がいません/),
      });
      expect(res.structuredContent).toEqual(res.json);
    } finally {
      await client.close();
    }
  });

  it('省略時は管理下の全員。勤務実績は期間で 1 回、打刻は日ごとに取る', async () => {
    const recordRanges: Array<{ from: string; to: string; staffIds?: number[] | undefined }> = [];
    const stampCalls: Array<{ date: string; ids: number[] }> = [];
    const backend = fakeBackend({
      listStaff: async () => ({ staff, totalCount: 2, truncated: false }),
      getWorkingRecords: async (range, options) => {
        recordRanges.push({ ...range, staffIds: options?.staffIds });
        return [
          {
            staffId: 1,
            date: '2026-10-01',
            dayCategory: 'workday' as const,
            actualWorkingMinutes: 480,
          },
        ];
      },
      getTeamStamps: async (date, ids) => {
        stampCalls.push({ date, ids });
        return { stamps: date === '2026-10-27' ? [clockIn(1)] : [], truncated: false };
      },
    });
    const out = (await teamCloseOutTool.handler(
      {},
      fakeContext(backend, {}, NOW),
    )) as TeamCloseoutReport;
    expect(recordRanges).toEqual([{ from: '2026-10-01', to: '2026-10-27', staffIds: [1, 2] }]);
    expect(stampCalls.map((c) => c.date)).toEqual(['2026-10-26', '2026-10-27']);
    expect(stampCalls[0]?.ids).toEqual([1, 2]);
    expect(out).toMatchObject({
      scope: 'day',
      noActivity: [{ staffId: 2, name: '架空 花子', staffNum: 'A002' }],
    });
    expect(teamCloseoutOutputSchema.strict().safeParse(out).success).toBe(true);
    expect(JSON.stringify(out)).toContain('A002');
    expect(out.noIssueCount).toBe(1);
  });

  it('月は 31 日を超えても取得範囲を渡し、問題が無ければ対応不要と明言する', async () => {
    const seen: Array<{ from: string; to: string }> = [];
    const backend = fakeBackend({
      listStaff: async () => ({
        staff: [{ staffId: 1, name: '架空 花子', staffNum: 'A001', organizationName: '開発部' }],
        totalCount: 1,
        truncated: false,
      }),
      getWorkingRecords: async (range) => {
        seen.push(range);
        return [];
      },
      getTeamStamps: async () => ({ stamps: [], truncated: false }),
    });
    const out = (await teamCloseOutTool.handler(
      { scope: 'month', month: '2026-09' },
      fakeContext(backend, {}, NOW),
    )) as TeamCloseoutReport;
    expect(seen).toEqual([{ from: '2026-09-01', to: '2026-09-30' }]);
    expect(out.ok).toBe(false);
    expect(out.noActivity).toHaveLength(1);
    expect(out.headline).toMatch(/1 人/);
  });

  it('管理下にいない staffIds は API を呼ばない', async () => {
    let called = false;
    const backend = fakeBackend({
      listStaff: async () => ({ staff, totalCount: 2, truncated: false }),
      getWorkingRecords: async () => {
        called = true;
        return [];
      },
    });
    await expect(
      teamCloseOutTool.handler({ staffIds: [999] }, fakeContext(backend, {}, NOW)),
    ).rejects.toThrow(/999/);
    expect(called).toBe(false);
  });

  it('未来の日、scope と引数の組み合わせ、取得失敗を案内する', async () => {
    const backend = fakeBackend({
      listStaff: async () => ({ staff, totalCount: 2, truncated: false }),
      getWorkingRecords: async () => {
        throw new Error('boom');
      },
      getTeamStamps: async () => ({ stamps: [], truncated: true }),
    });
    const ctx = fakeContext(backend, {}, NOW);
    await expect(teamCloseOutTool.handler({ date: '2026-10-28' }, ctx)).rejects.toThrow(/future/);
    await expect(teamCloseOutTool.handler({ scope: 'day', month: '2026-10' }, ctx)).rejects.toThrow(
      /scope "month"/,
    );
    const out = (await teamCloseOutTool.handler(
      { scope: 'day', date: '2026-10-26' },
      ctx,
    )) as TeamCloseoutReport;
    expect(out.ok).toBe(false);
    expect(out.gaps?.join('\n')).toMatch(/get_working_records failed/);
    expect(out.gaps?.join('\n')).toMatch(/limit/);
    expect(out.noActivity).toEqual([]);
  });

  it('未来の月は拒否する', async () => {
    const backend = fakeBackend({
      listStaff: async () => ({ staff, totalCount: 2, truncated: false }),
    });
    await expect(
      teamCloseOutTool.handler({ scope: 'month', month: '2026-11' }, fakeContext(backend, {}, NOW)),
    ).rejects.toThrow(/not started/);
  });
});
