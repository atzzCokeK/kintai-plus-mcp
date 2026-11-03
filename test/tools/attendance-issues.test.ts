import { describe, expect, it } from 'vitest';
import type { DateRange } from '../../src/api/paging.ts';
import { STAMP_TYPE_CODES } from '../../src/api/stamps.ts';
import { checkAttendanceIssuesTool } from '../../src/tools/attendance-issues.ts';
import { fakeBackend, fakeContext } from '../helpers/fake-backend.ts';

describe('check_attendance_issues', () => {
  it('既定は今月 1 日〜昨日。打刻漏れなどを重要度つきで返す', async () => {
    const ranges: DateRange[] = [];
    const backend = fakeBackend({
      getWorkingRecords: async (range) => {
        ranges.push(range);
        return [{ date: '2026-10-01', dayCategory: 'workday', actualWorkingMinutes: 480 }];
      },
      getStamps: async (range) => {
        ranges.push(range);
        return {
          stamps: [
            {
              type: 'clock_in',
              typeCode: STAMP_TYPE_CODES.clock_in,
              stampedAt: new Date('2026-10-01T09:00:00+09:00'),
              attributes: {},
            },
          ],
          truncated: false,
        };
      },
    });
    const out = await checkAttendanceIssuesTool.handler(
      {},
      fakeContext(backend, {}, new Date('2026-10-27T01:00:00Z')),
    );
    expect(ranges).toEqual([
      { from: '2026-10-01', to: '2026-10-26' },
      { from: '2026-09-30', to: '2026-10-27' },
    ]);
    expect(out).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-26',
      counts: { error: 1, warning: 0, info: 0 },
      issues: [{ date: '2026-10-01', type: 'missing_clock_out', severity: 'error' }],
    });
    expect(JSON.stringify(out)).toMatch(/申請/);
  });

  it('日本時間の月初 0 時台は前月をみる。翌朝の退勤があれば打刻漏れにしない', async () => {
    const ranges: DateRange[] = [];
    const backend = fakeBackend({
      getWorkingRecords: async (range) => {
        ranges.push(range);
        return [{ date: '2026-02-28', dayCategory: 'workday', actualWorkingMinutes: 480 }];
      },
      getStamps: async (range) => {
        ranges.push(range);
        const coversMorning = range.from <= '2026-02-28' && range.to >= '2026-03-01';
        return {
          stamps: coversMorning
            ? [
                {
                  type: 'clock_in' as const,
                  typeCode: STAMP_TYPE_CODES.clock_in,
                  stampedAt: new Date('2026-02-28T22:00:00+09:00'),
                  attributes: {},
                },
                {
                  type: 'clock_out' as const,
                  typeCode: STAMP_TYPE_CODES.clock_out,
                  stampedAt: new Date('2026-03-01T06:00:00+09:00'),
                  attributes: {},
                },
              ]
            : [],
          truncated: false,
        };
      },
    });
    // 2026-03-01 00:30 JST。UTC ではまだ 2 月 28 日。
    const out = await checkAttendanceIssuesTool.handler(
      {},
      fakeContext(backend, {}, new Date('2026-02-28T15:30:00Z')),
    );
    expect(ranges).toEqual([
      { from: '2026-02-01', to: '2026-02-28' },
      { from: '2026-01-31', to: '2026-03-01' },
    ]);
    expect(out).toMatchObject({ from: '2026-02-01', to: '2026-02-28', issues: [] });
  });

  it('月初（1 日）に呼んだら前月をみる', async () => {
    const ranges: DateRange[] = [];
    const backend = fakeBackend({
      getWorkingRecords: async (range) => {
        ranges.push(range);
        return [];
      },
      getStamps: async () => ({ stamps: [], truncated: false }),
    });
    await checkAttendanceIssuesTool.handler(
      {},
      fakeContext(backend, {}, new Date('2026-11-01T01:00:00Z')),
    );
    expect(ranges[0]).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });
});
