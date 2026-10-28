import { describe, expect, it } from 'vitest';
import type { DateRange } from '../../src/api/paging.ts';
import { summarizeWorkingHoursTool } from '../../src/tools/summary.ts';
import { fakeBackend, fakeContext } from '../helpers/fake-backend.ts';

const NOW = new Date('2026-10-27T01:00:00Z');

describe('summarize_working_hours', () => {
  it('既定は今月 1 日〜今日。合計・月ごとの内訳・目安である旨を返す', async () => {
    const seen: DateRange[] = [];
    const backend = fakeBackend({
      getWorkingRecords: async (range) => {
        seen.push(range);
        return [
          { date: '2026-10-01', dayCategory: 'workday', actualWorkingMinutes: 600 },
          { date: '2026-10-04', dayCategory: 'legal_holiday', actualWorkingMinutes: 120 },
        ];
      },
    });
    const out = (await summarizeWorkingHoursTool.handler(
      {},
      fakeContext(backend, {}, NOW),
    )) as Record<string, unknown>;
    expect(seen).toEqual([{ from: '2026-10-01', to: '2026-10-27' }]);
    expect(out).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-27',
      totalWorkingMinutes: 720,
      totalWorkingHours: '12:00',
      workDays: 2,
      holidayWorkDays: 1,
      estimatedOvertimeMinutes: 240,
      estimatedOvertimeHours: '4:00',
    });
    expect(out.months).toEqual([
      expect.objectContaining({
        month: '2026-10',
        totalWorkingMinutes: 720,
        estimatedOvertimeMinutes: 240,
      }),
    ]);
    expect(String(out.disclaimer)).toMatch(/目安/);
    expect(String(out.disclaimer)).toMatch(/40/);
  });

  it('複数月にまたがると月ごとに分ける', async () => {
    const backend = fakeBackend({
      getWorkingRecords: async () => [
        { date: '2026-09-30', dayCategory: 'workday', actualWorkingMinutes: 540 },
        { date: '2026-10-01', dayCategory: 'workday', actualWorkingMinutes: 480 },
      ],
    });
    const out = (await summarizeWorkingHoursTool.handler(
      { from: '2026-09-01', to: '2026-10-31' },
      fakeContext(backend, {}, NOW),
    )) as { months: Array<{ month: string; estimatedOvertimeMinutes: number }> };
    expect(out.months.map((m) => [m.month, m.estimatedOvertimeMinutes])).toEqual([
      ['2026-09', 60],
      ['2026-10', 0],
    ]);
  });
});
