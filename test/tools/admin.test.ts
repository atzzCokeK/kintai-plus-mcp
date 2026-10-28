import { describe, expect, it } from 'vitest';
import { STAMP_TYPE_CODES, type Stamp, type StampType } from '../../src/api/stamps.ts';
import {
  getProjectMembersTool,
  getTeamStampsTool,
  getWorkingStatusesTool,
  listStaffTool,
} from '../../src/tools/admin.ts';
import { ToolInputError } from '../../src/tools/result.ts';
import { fakeBackend, fakeContext } from '../helpers/fake-backend.ts';

const NOW = new Date('2026-10-27T03:00:00Z'); // 12:00 JST
const s = (staffId: number, type: StampType, hhmm: string, attributes = {}): Stamp => ({
  staffId,
  type,
  typeCode: STAMP_TYPE_CODES[type],
  stampedAt: new Date(`2026-10-27T${hhmm}:00+09:00`),
  attributes,
});

const staff = [
  {
    staffId: 1,
    name: '山田 花子',
    email: 'h@example.com',
    staffNum: 'E1',
    organizationName: '開発部',
    permissionType: 2,
  },
  {
    staffId: 2,
    name: '佐藤 太郎',
    email: 't@example.com',
    staffNum: 'E2',
    organizationName: '営業部',
  },
  { staffId: 3, name: '鈴木 一郎', organizationName: '開発部' },
];

function backend(overrides = {}) {
  return fakeBackend({
    listStaff: async () => ({ staff, totalCount: 3, truncated: false }),
    ...overrides,
  });
}

describe('list_staff', () => {
  it('管理下の従業員を最小限の項目で返す（メールは渡さない）', async () => {
    const out = await listStaffTool.handler({}, fakeContext(backend(), {}, NOW));
    expect(out).toEqual({
      totalCount: 3,
      count: 3,
      staff: [
        { staffId: 1, name: '山田 花子', staffNum: 'E1', organizationName: '開発部' },
        { staffId: 2, name: '佐藤 太郎', staffNum: 'E2', organizationName: '営業部' },
        { staffId: 3, name: '鈴木 一郎', organizationName: '開発部' },
      ],
    });
    expect(JSON.stringify(out)).not.toContain('@example.com');
  });

  it('氏名・社員番号・所属で絞り込める', async () => {
    const out = (await listStaffTool.handler(
      { query: '開発' },
      fakeContext(backend(), {}, NOW),
    )) as {
      staff: Array<{ staffId: number }>;
    };
    expect(out.staff.map((x) => x.staffId)).toEqual([1, 3]);
  });

  it('管理者向けとして申告する', () => {
    expect(listStaffTool.audience).toBe('admin');
  });
});

describe('get_team_stamps', () => {
  it('既定は今日・管理下の全員。各人の状況をまとめて返す', async () => {
    const seen: unknown[] = [];
    const b = backend({
      getTeamStamps: async (date: string, ids: number[]) => {
        seen.push([date, ids]);
        return {
          stamps: [
            s(1, 'clock_in', '09:00', { latitude: 35 }),
            s(2, 'clock_in', '08:00'),
            s(2, 'break_start', '11:30'),
          ],
          truncated: false,
        };
      },
    });
    const out = (await getTeamStampsTool.handler({}, fakeContext(b, {}, NOW))) as Record<
      string,
      unknown
    >;
    expect(seen).toEqual([['2026-10-27', [1, 2, 3]]]);
    expect(out.summary).toEqual({ not_started: 1, working: 1, on_break: 1, finished: 0 });
    expect(out.staff).toEqual([
      {
        staffId: 1,
        name: '山田 花子',
        state: 'working',
        stateLabel: '勤務中',
        workedMinutes: 180,
        firstClockInAt: '2026-10-27T09:00:00+09:00',
      },
      {
        staffId: 2,
        name: '佐藤 太郎',
        state: 'on_break',
        stateLabel: '休憩中',
        workedMinutes: 210,
        firstClockInAt: '2026-10-27T08:00:00+09:00',
      },
      {
        staffId: 3,
        name: '鈴木 一郎',
        state: 'not_started',
        stateLabel: '未出勤',
        workedMinutes: 0,
      },
    ]);
  });

  it('includeStamps で打刻も返す（位置情報は除く）。過去の日は終日で数える', async () => {
    const b = backend({
      getTeamStamps: async () => ({
        stamps: [s(1, 'clock_in', '09:00', { latitude: 35, method: 1 })],
        truncated: false,
      }),
    });
    const out = (await getTeamStampsTool.handler(
      { staffIds: [1], includeStamps: true },
      fakeContext(b, {}, NOW),
    )) as { staff: Array<Record<string, unknown>> };
    expect(out.staff[0]?.stamps).toEqual([
      {
        stampedAt: '2026-10-27T09:00:00+09:00',
        type: 'clock_in',
        typeLabel: '出勤',
        attributes: { method: 1 },
      },
    ]);
  });
});

describe('get_working_statuses', () => {
  it('期間 × 従業員で検索し、ラベルのあるものを名前付きで返す', async () => {
    const seen: unknown[] = [];
    const b = backend({
      getWorkingStatuses: async (search: unknown[]) => {
        seen.push(search);
        return [
          { staffId: 2, date: '2026-10-26', labels: ['出張'] },
          { staffId: 3, date: '2026-10-27', labels: [] },
        ];
      },
    });
    const out = await getWorkingStatusesTool.handler(
      { from: '2026-10-26', to: '2026-10-27', staffIds: [2, 3] },
      fakeContext(b, {}, NOW),
    );
    expect(seen[0]).toEqual([
      { staffId: 2, date: '2026-10-26' },
      { staffId: 3, date: '2026-10-26' },
      { staffId: 2, date: '2026-10-27' },
      { staffId: 3, date: '2026-10-27' },
    ]);
    expect(out).toEqual({
      from: '2026-10-26',
      to: '2026-10-27',
      count: 1,
      statuses: [{ staffId: 2, name: '佐藤 太郎', date: '2026-10-26', labels: ['出張'] }],
    });
  });

  it('組み合わせが多すぎれば入力エラー', async () => {
    const many = Array.from({ length: 200 }, (_, i) => i + 1);
    await expect(
      getWorkingStatusesTool.handler(
        { from: '2026-10-01', to: '2026-10-31', staffIds: many },
        fakeContext(backend(), {}, NOW),
      ),
    ).rejects.toThrow(ToolInputError);
  });
});

describe('get_project_members', () => {
  it('メンバーとオーナーを名前付きで返す', async () => {
    const b = backend({
      getProjectMembers: async () => ({ staffIds: [1, 9], ownerStaffIds: [1] }),
    });
    const out = await getProjectMembersTool.handler({ projectId: 3 }, fakeContext(b, {}, NOW));
    expect(out).toEqual({
      projectId: 3,
      count: 2,
      members: [
        { staffId: 1, name: '山田 花子', staffNum: 'E1', organizationName: '開発部', owner: true },
        { staffId: 9, owner: false },
      ],
    });
  });
});
