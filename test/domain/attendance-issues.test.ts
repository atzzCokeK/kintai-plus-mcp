import { describe, expect, it } from 'vitest';
import { STAMP_TYPE_CODES, type Stamp, type StampType } from '../../src/api/stamps.ts';
import type { DayCategory, WorkingRecord } from '../../src/api/working-records.ts';
import { findAttendanceIssues } from '../../src/domain/attendance-issues.ts';

const s = (type: StampType, iso: string): Stamp => ({
  type,
  typeCode: STAMP_TYPE_CODES[type],
  stampedAt: new Date(iso),
  attributes: {},
});
const rec = (date: string, dayCategory: DayCategory, minutes?: number): WorkingRecord => ({
  date,
  dayCategory,
  ...(minutes === undefined ? {} : { actualWorkingMinutes: minutes }),
});
const types = (issues: Array<{ date: string; type: string }>) =>
  issues.map((i) => `${i.date} ${i.type}`);

describe('findAttendanceIssues', () => {
  it('退勤の打刻忘れ・休憩戻の打刻忘れ・出勤の打刻忘れ', () => {
    const issues = findAttendanceIssues({
      range: { from: '2026-10-01', to: '2026-10-03' },
      records: [
        rec('2026-10-01', 'workday', 480),
        rec('2026-10-02', 'workday', 180),
        rec('2026-10-03', 'workday', 480),
      ],
      stamps: [
        s('clock_in', '2026-10-01T09:00:00+09:00'),
        s('clock_in', '2026-10-02T09:00:00+09:00'),
        s('break_start', '2026-10-02T12:00:00+09:00'),
        s('clock_out', '2026-10-03T18:00:00+09:00'),
      ],
    });
    expect(types(issues)).toEqual([
      '2026-10-01 missing_clock_out',
      '2026-10-02 missing_break_end',
      '2026-10-03 missing_clock_in',
    ]);
    expect(issues[0]?.severity).toBe('error');
  });

  it('日をまたぐ勤務（前日に出勤、翌日に退勤）は打刻忘れにしない', () => {
    const issues = findAttendanceIssues({
      range: { from: '2026-10-01', to: '2026-10-02' },
      records: [rec('2026-10-01', 'workday', 480), rec('2026-10-02', 'scheduled_holiday', 0)],
      stamps: [
        s('clock_in', '2026-10-01T22:00:00+09:00'),
        s('clock_out', '2026-10-02T06:00:00+09:00'),
      ],
    });
    expect(types(issues)).toEqual([]);
  });

  it('翌日の退勤まで 16 時間を超えるなら、日をまたぐ勤務ではなく打刻忘れ', () => {
    const issues = findAttendanceIssues({
      range: { from: '2026-10-01', to: '2026-10-02' },
      records: [],
      stamps: [
        s('clock_in', '2026-10-01T09:00:00+09:00'),
        s('clock_out', '2026-10-02T18:00:00+09:00'),
      ],
    });
    expect(types(issues)).toEqual(['2026-10-01 missing_clock_out', '2026-10-02 missing_clock_in']);
  });

  it('範囲の前日の打刻も渡せば、初日の朝に終わる夜勤を打刻忘れにしない（前日の問題は出さない）', () => {
    const issues = findAttendanceIssues({
      range: { from: '2026-10-02', to: '2026-10-02' },
      records: [],
      stamps: [
        s('clock_in', '2026-09-30T09:00:00+09:00'),
        s('clock_in', '2026-10-01T22:00:00+09:00'),
        s('clock_out', '2026-10-02T06:00:00+09:00'),
      ],
    });
    expect(types(issues)).toEqual([]);
  });

  it('労働日に打刻がない（休暇の可能性あり）', () => {
    const issues = findAttendanceIssues({
      range: { from: '2026-10-05', to: '2026-10-05' },
      records: [rec('2026-10-05', 'workday', 0)],
      stamps: [],
    });
    expect(issues).toEqual([
      expect.objectContaining({
        date: '2026-10-05',
        type: 'no_punches_on_workday',
        severity: 'warning',
      }),
    ]);
    expect(issues[0]?.message).toMatch(/休暇/);
  });

  it('長時間労働（12 時間超）と勤務間インターバル不足（11 時間未満）', () => {
    const issues = findAttendanceIssues({
      range: { from: '2026-10-06', to: '2026-10-07' },
      records: [rec('2026-10-06', 'workday', 780), rec('2026-10-07', 'workday', 480)],
      stamps: [
        s('clock_in', '2026-10-06T09:00:00+09:00'),
        s('clock_out', '2026-10-06T23:00:00+09:00'),
        s('clock_in', '2026-10-07T08:00:00+09:00'),
        s('clock_out', '2026-10-07T17:00:00+09:00'),
      ],
    });
    expect(types(issues)).toEqual(['2026-10-06 long_working_day', '2026-10-07 short_interval']);
    expect(issues[1]?.message).toMatch(/9:00/);
  });

  it('法定休日の出勤は情報として出す', () => {
    const issues = findAttendanceIssues({
      range: { from: '2026-10-04', to: '2026-10-04' },
      records: [rec('2026-10-04', 'legal_holiday', 240)],
      stamps: [
        s('clock_in', '2026-10-04T10:00:00+09:00'),
        s('clock_out', '2026-10-04T14:00:00+09:00'),
      ],
    });
    expect(issues).toEqual([expect.objectContaining({ type: 'holiday_work', severity: 'info' })]);
  });

  it('勤務実績に開始・終了があれば、打刻が欠けていても打刻漏れにしない', () => {
    const at = (iso: string) => new Date(iso);
    const issues = findAttendanceIssues({
      range: { from: '2026-10-01', to: '2026-10-03' },
      records: [
        {
          ...rec('2026-10-01', 'workday', 480),
          clockOutAt: at('2026-10-01T18:00:00+09:00'),
        },
        {
          ...rec('2026-10-02', 'workday', 480),
          endTime: at('2026-10-02T18:00:00+09:00'),
        },
        {
          ...rec('2026-10-03', 'workday', 480),
          startTime: at('2026-10-03T09:00:00+09:00'),
        },
      ],
      stamps: [
        s('clock_in', '2026-10-01T09:00:00+09:00'),
        s('clock_in', '2026-10-02T09:00:00+09:00'),
        s('break_start', '2026-10-02T12:00:00+09:00'),
        s('clock_out', '2026-10-03T18:00:00+09:00'),
      ],
    });
    expect(types(issues)).toEqual([]);
  });

  it('休憩が不明な経過は、12 時間超を情報にし、1 時間引いても超えるときだけ警告にする', () => {
    const gross = (date: string, minutes: number): WorkingRecord => ({
      date,
      dayCategory: 'workday',
      actualWorkingMinutes: minutes,
      workingMinutesAreGross: true,
    });
    const issues = findAttendanceIssues({
      range: { from: '2026-10-08', to: '2026-10-09' },
      records: [gross('2026-10-08', 13 * 60), gross('2026-10-09', 13 * 60 + 1)],
      stamps: [
        s('clock_in', '2026-10-08T09:00:00+09:00'),
        s('clock_out', '2026-10-08T22:00:00+09:00'),
        s('clock_in', '2026-10-09T09:00:00+09:00'),
        s('clock_out', '2026-10-09T22:01:00+09:00'),
      ],
    });
    expect(issues.map((i) => [i.date, i.type, i.severity])).toEqual([
      ['2026-10-08', 'long_working_day', 'info'],
      ['2026-10-09', 'long_working_day', 'warning'],
    ]);
    expect(issues[0]?.message).toMatch(/休憩/);
    expect(issues[1]?.message).toMatch(/休憩/);
  });

  it('問題がなければ空', () => {
    expect(
      findAttendanceIssues({
        range: { from: '2026-10-01', to: '2026-10-01' },
        records: [rec('2026-10-01', 'workday', 480)],
        stamps: [
          s('clock_in', '2026-10-01T09:00:00+09:00'),
          s('clock_out', '2026-10-01T18:00:00+09:00'),
        ],
      }),
    ).toEqual([]);
  });
});
