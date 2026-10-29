import type { WorkingRecord } from '../api/working-records.ts';

/** 1 日の法定労働時間（分） */
const DAILY_LIMIT_MINUTES = 8 * 60;

export interface WorkingHoursSummary {
  /** 記録のある日数 */
  days: number;
  /** 出勤日数（実働が 0 より大きい日） */
  workDays: number;
  /** 休日出勤日数（所定休日・法定休日に実働がある日） */
  holidayWorkDays: number;
  scheduledHolidayWorkDays: number;
  legalHolidayWorkDays: number;
  totalWorkingMinutes: number;
  averageMinutesPerWorkDay: number;
  /** 法定時間外の目安 = overDailyLimitMinutes + legalHolidayMinutes */
  estimatedOvertimeMinutes: number;
  /** 労働日・所定休日の 1 日 8 時間を超えた分 */
  overDailyLimitMinutes: number;
  /** 法定休日の労働時間（全時間） */
  legalHolidayMinutes: number;
  /** 休憩を除いた実働が無く、開始〜終了の経過（休憩を含む）で数えた日がある */
  breakTimeUnknown: boolean;
}

/** ツールの注意書きに足す。実働が経過時間のときに使う。 */
export const UNKNOWN_BREAK_NOTE =
  '勤務実績 API は実働時間と休憩を返さないため、実働は開始時刻から終了時刻までの経過（休憩を含む）の目安です。休憩時間は不明です。';

/**
 * 勤務実績から集計する（ADR 0006）。法定時間外は「目安」:
 * 労働日（と所定休日）は 1 日 8 時間を超えた分、法定休日は全時間。
 * 週 40 時間・変形労働時間制・フレックスは考慮しない。
 */
export function summarizeWorkingHours(records: readonly WorkingRecord[]): WorkingHoursSummary {
  const s: WorkingHoursSummary = {
    days: records.length,
    workDays: 0,
    holidayWorkDays: 0,
    scheduledHolidayWorkDays: 0,
    legalHolidayWorkDays: 0,
    totalWorkingMinutes: 0,
    averageMinutesPerWorkDay: 0,
    estimatedOvertimeMinutes: 0,
    overDailyLimitMinutes: 0,
    legalHolidayMinutes: 0,
    breakTimeUnknown: false,
  };
  for (const record of records) {
    const minutes = Math.max(0, record.actualWorkingMinutes ?? 0);
    if (minutes === 0) continue;
    if (record.workingMinutesAreGross) s.breakTimeUnknown = true;
    s.workDays++;
    s.totalWorkingMinutes += minutes;
    if (record.dayCategory === 'legal_holiday') {
      s.holidayWorkDays++;
      s.legalHolidayWorkDays++;
      s.legalHolidayMinutes += minutes;
      continue;
    }
    if (record.dayCategory === 'scheduled_holiday') {
      s.holidayWorkDays++;
      s.scheduledHolidayWorkDays++;
    }
    s.overDailyLimitMinutes += Math.max(0, minutes - DAILY_LIMIT_MINUTES);
  }
  s.averageMinutesPerWorkDay =
    s.workDays === 0 ? 0 : Math.round(s.totalWorkingMinutes / s.workDays);
  s.estimatedOvertimeMinutes = s.overDailyLimitMinutes + s.legalHolidayMinutes;
  return s;
}
