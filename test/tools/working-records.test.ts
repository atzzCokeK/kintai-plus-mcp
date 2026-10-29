import { describe, expect, it } from 'vitest';
import type { DateRange } from '../../src/api/paging.ts';
import { getWorkingRecordsTool } from '../../src/tools/working-records.ts';
import { fakeBackend, fakeContext } from '../helpers/fake-backend.ts';

const NOW = new Date('2026-10-27T01:00:00Z');

describe('get_working_records', () => {
  it('既定は今月 1 日〜今日。時刻は ISO、実働は分と H:MM', async () => {
    const seen: DateRange[] = [];
    const backend = fakeBackend({
      getWorkingRecords: async (range) => {
        seen.push(range);
        return [
          {
            staffId: 7,
            date: '2026-10-01',
            dayCategory: 'workday',
            startTime: new Date('2026-10-01T00:00:00Z'),
            endTime: new Date('2026-10-01T09:00:00Z'),
            clockInAt: new Date('2026-09-30T23:58:00Z'),
            actualWorkingMinutes: 480,
            breakMinutes: 60,
          },
          { staffId: 7, date: '2026-10-03', dayCategory: 'legal_holiday' },
        ];
      },
    });
    const out = await getWorkingRecordsTool.handler({}, fakeContext(backend, {}, NOW));
    expect(seen).toEqual([{ from: '2026-10-01', to: '2026-10-27' }]);
    expect(out).toEqual({
      from: '2026-10-01',
      to: '2026-10-27',
      count: 2,
      records: [
        {
          date: '2026-10-01',
          dayCategory: 'workday',
          dayCategoryLabel: '労働日',
          startTime: '2026-10-01T09:00:00+09:00',
          endTime: '2026-10-01T18:00:00+09:00',
          clockInAt: '2026-10-01T08:58:00+09:00',
          actualWorkingMinutes: 480,
          actualWorkingHours: '8:00',
          breakMinutes: 60,
        },
        { date: '2026-10-03', dayCategory: 'legal_holiday', dayCategoryLabel: '法定休日' },
      ],
    });
  });

  it('見積もった実働は経過時間だと示し、休憩は unknown', async () => {
    const backend = fakeBackend({
      getWorkingRecords: async () => [
        {
          date: '2026-10-20',
          dayCategory: 'workday',
          startTime: new Date('2026-10-20T13:00:00Z'),
          endTime: new Date('2026-10-22T11:03:00Z'),
          actualWorkingMinutes: 2763,
          workingMinutesAreGross: true,
        },
      ],
    });
    const out = await getWorkingRecordsTool.handler(
      { from: '2026-10-20', to: '2026-10-22' },
      fakeContext(backend, {}, NOW),
    );
    expect(out).toMatchObject({
      records: [
        {
          date: '2026-10-20',
          actualWorkingMinutes: 2763,
          actualWorkingHours: '46:03',
          actualWorkingMinutesEstimated: true,
          breakTime: 'unknown',
        },
      ],
    });
  });

  it('最大 366 日', async () => {
    await expect(
      getWorkingRecordsTool.handler(
        { from: '2025-01-01', to: '2026-10-01' },
        fakeContext(fakeBackend(), {}, NOW),
      ),
    ).rejects.toThrow(/366/);
  });
});
