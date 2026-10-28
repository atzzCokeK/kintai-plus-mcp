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
}

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
  };
  for (const record of records) {
    const minutes = Math.max(0, record.actualWorkingMinutes ?? 0);
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
