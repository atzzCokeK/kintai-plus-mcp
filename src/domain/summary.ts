import type { WorkingRecord } from '../api/working-records.ts';
import { readWorkingMinutes } from './worked-minutes.ts';

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
  /** 休憩が不明で、法定の最低休憩を引いた見積もりを使った日がある */
  breakTimeUnknown: boolean;
  /** 実働が無く、経過から休憩実績か法定休憩を引いて数えた日がある */
  minutesAreEstimated: boolean;
  /** 見積もった日の、引く前の経過の合計。併記用。見積もりが無いときは 0 */
  grossElapsedMinutes: number;
}

/** ツールの注意書きに足す。実働が経過時間のときに使う。 */
export const UNKNOWN_BREAK_NOTE =
  '実働時間が無い日は、開始から終了までの経過です。休憩実績があればそれを引き、無いときは法定の最低休憩（6時間超で45分、8時間超で60分）を引いた見積もりを実働に使います。実際の休憩がこれより長いと多め、短いと少なめです。引く前の経過は grossElapsedMinutes に併記します。';

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
    minutesAreEstimated: false,
    grossElapsedMinutes: 0,
  };
  for (const record of records) {
    const reading = readWorkingMinutes(record);
    if (reading.basis === 'statutory_minimum') s.breakTimeUnknown = true;
    if (reading.basis === 'statutory_minimum' || reading.basis === 'break_results') {
      s.minutesAreEstimated = true;
      s.grossElapsedMinutes += reading.elapsedMinutes ?? 0;
    }
    const minutes = Math.max(0, reading.netMinutes);
    if (minutes === 0) continue;
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
