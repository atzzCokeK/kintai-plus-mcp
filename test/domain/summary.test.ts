import { describe, expect, it } from 'vitest';
import type { DayCategory, WorkingRecord } from '../../src/api/working-records.ts';
import { summarizeWorkingHours } from '../../src/domain/summary.ts';

const r = (date: string, dayCategory: DayCategory, minutes?: number): WorkingRecord => ({
  date,
  dayCategory,
  ...(minutes === undefined ? {} : { actualWorkingMinutes: minutes }),
});

describe('summarizeWorkingHours', () => {
  it('実働合計・出勤日数・休日出勤日数・法定時間外の目安を出す', () => {
    const s = summarizeWorkingHours([
      r('2026-10-01', 'workday', 480), // 8:00 → 時間外 0
      r('2026-10-02', 'workday', 600), // 10:00 → 時間外 2:00
      r('2026-10-03', 'scheduled_holiday', 540), // 所定休日 9:00 → 8 時間超の 1:00
      r('2026-10-04', 'legal_holiday', 240), // 法定休日 4:00 → 全時間
      r('2026-10-05', 'workday', 0), // 出勤なし
      r('2026-10-06', 'workday'), // 値なし
    ]);
    expect(s).toEqual({
      days: 6,
      workDays: 4,
      holidayWorkDays: 2,
      scheduledHolidayWorkDays: 1,
      legalHolidayWorkDays: 1,
      totalWorkingMinutes: 1860,
      averageMinutesPerWorkDay: 465,
      estimatedOvertimeMinutes: 420,
      overDailyLimitMinutes: 180,
      legalHolidayMinutes: 240,
      breakTimeUnknown: false,
      minutesAreEstimated: false,
      grossElapsedMinutes: 0,
    });
  });

  it('休憩が不明な経過時間でも集計し、不明フラグを立てる', () => {
    const s = summarizeWorkingHours([
      {
        date: '2026-10-01',
        dayCategory: 'workday',
        actualWorkingMinutes: 600,
        workingMinutesAreGross: true,
      },
    ]);
    expect(s.totalWorkingMinutes).toBe(540);
    expect(s.overDailyLimitMinutes).toBe(60);
    expect(s.grossElapsedMinutes).toBe(600);
    expect(s.minutesAreEstimated).toBe(true);
    expect(s.breakTimeUnknown).toBe(true);
  });

  it('6 時間超 8 時間以下の経過は 45 分、休憩実績があればその分数を引く', () => {
    const statutory = summarizeWorkingHours([
      {
        date: '2026-10-01',
        dayCategory: 'workday',
        actualWorkingMinutes: 7 * 60,
        workingMinutesAreGross: true,
      },
    ]);
    expect(statutory.totalWorkingMinutes).toBe(7 * 60 - 45);
    expect(statutory.breakTimeUnknown).toBe(true);

    const measured = summarizeWorkingHours([
      {
        date: '2026-10-02',
        dayCategory: 'workday',
        actualWorkingMinutes: 600,
        workingMinutesAreGross: true,
        breakMinutes: 30,
      },
    ]);
    expect(measured.totalWorkingMinutes).toBe(570);
    expect(measured.overDailyLimitMinutes).toBe(90);
    expect(measured.grossElapsedMinutes).toBe(600);
    expect(measured.breakTimeUnknown).toBe(false);
    expect(measured.minutesAreEstimated).toBe(true);
  });

  it('記録がなければ 0', () => {
    expect(summarizeWorkingHours([])).toMatchObject({
      days: 0,
      workDays: 0,
      totalWorkingMinutes: 0,
      averageMinutesPerWorkDay: 0,
      estimatedOvertimeMinutes: 0,
    });
  });

  it('区分が不明な日は労働日として扱う', () => {
    expect(summarizeWorkingHours([r('2026-10-01', 'unknown', 540)]).overDailyLimitMinutes).toBe(60);
  });
});
