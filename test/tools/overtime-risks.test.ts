import { describe, expect, it } from 'vitest';
import type { DateRange } from '../../src/api/paging.ts';
import type { WorkingRecord } from '../../src/api/working-records.ts';
import { findOvertimeRisksTool } from '../../src/tools/overtime-risks.ts';
import { ToolInputError } from '../../src/tools/result.ts';
import { fakeBackend, fakeContext } from '../helpers/fake-backend.ts';

const NOW = new Date('2026-10-17T01:00:00Z'); // 10/17 (土) 10:00 JST → 実績は 10/16 まで

function days(staffId: number, n: number, minutes: number): WorkingRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    staffId,
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    dayCategory: 'workday' as const,
    actualWorkingMinutes: minutes,
  }));
}

function setup() {
  const calls: Array<{ range: DateRange; staffIds: number[] | undefined }> = [];
  const backend = fakeBackend({
    listStaff: async () => ({
      staff: [
        { staffId: 1, name: '山田 花子', email: 'x@example.com' },
        { staffId: 2, name: '佐藤 太郎' },
        { staffId: 3, name: '鈴木 一郎' },
      ],
      totalCount: 3,
      truncated: false,
    }),
    getWorkingRecords: async (range, options) => {
      calls.push({ range, staffIds: options?.staffIds });
      return [...days(1, 12, 600), ...days(2, 12, 480), ...days(3, 2, 480 + 300)];
    },
  });
  return { ctx: fakeContext(backend, {}, NOW), calls };
}

describe('find_overtime_risks', () => {
  it('今月の実績（昨日まで）から月末の着地を予測し、リスクのある人だけを予測の多い順に返す', async () => {
    const { ctx, calls } = setup();
    const out = (await findOvertimeRisksTool.handler({}, ctx)) as Record<string, unknown>;
    expect(calls).toEqual([
      { range: { from: '2026-10-01', to: '2026-10-16' }, staffIds: [1, 2, 3] },
    ]);
    expect(out).toMatchObject({
      month: '2026-10',
      asOf: '2026-10-16',
      thresholdHours: 45,
      counts: { over: 0, likely: 1, watch: 1, ok: 1 },
    });
    expect(out.staff).toEqual([
      expect.objectContaining({
        staffId: 3,
        name: '鈴木 一郎',
        level: 'likely',
        projectedOvertimeHours: '60:00',
      }),
      expect.objectContaining({
        staffId: 1,
        name: '山田 花子',
        level: 'watch',
        projectedOvertimeHours: '44:00',
      }),
    ]);
    expect(JSON.stringify(out)).not.toContain('@example.com');
    expect(String(out.disclaimer)).toMatch(/目安/);
  });

  it('しきい値を変えられる。includeAll で全員', async () => {
    const { ctx } = setup();
    const out = (await findOvertimeRisksTool.handler(
      { thresholdHours: 30, includeAll: true },
      ctx,
    )) as {
      staff: Array<{ staffId: number; level: string }>;
    };
    expect(out.staff.map((s) => [s.staffId, s.level])).toEqual([
      [3, 'likely'],
      [1, 'likely'],
      [2, 'ok'],
    ]);
  });

  it('過去の月は実績そのまま、未来の月はエラー', async () => {
    const { ctx, calls } = setup();
    await findOvertimeRisksTool.handler({ month: '2026-09' }, ctx);
    expect(calls[0]?.range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    await expect(findOvertimeRisksTool.handler({ month: '2026-11' }, ctx)).rejects.toThrow(
      ToolInputError,
    );
    await expect(findOvertimeRisksTool.handler({ month: '2026-13' }, ctx)).rejects.toThrow(/01-12/);
  });

  it('管理者向け', () => {
    expect(findOvertimeRisksTool.audience).toBe('admin');
  });
});
