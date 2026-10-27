import type { WorkingRecord } from '../api/working-records.ts';
import { addDays, diffDays, type LocalDate, startOfDay } from '../time/datetime.ts';
import { summarizeWorkingHours } from './summary.ts';

/** over: 既に超えた / likely: このペースだと超える / watch: しきい値の 8 割に届く / ok */
export type RiskLevel = 'over' | 'likely' | 'watch' | 'ok';

export interface OvertimeRisk {
  overtimeSoFarMinutes: number;
  elapsedWorkDays: number;
  remainingWorkDays: number;
  projectedOvertimeMinutes: number;
  level: RiskLevel;
}

const WATCH_RATIO = 0.8;

/** 両端を含む平日（月〜金）の数。祝日は考慮しない */
export function countWeekdays(from: LocalDate, to: LocalDate): number {
  let count = 0;
  for (let i = 0; i <= diffDays(from, to); i++) {
    // startOfDay は JST の 0 時。+9 時間した UTC の曜日が JST の曜日
    const day = new Date(startOfDay(addDays(from, i)).getTime() + 9 * 3_600_000).getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/**
 * 月の途中までの勤務実績から、月末の法定時間外（目安）を予測する。
 * 予測 = ここまで + （ここまで ÷ 出勤した日数）× 残りの平日数。祝日・休暇の予定は考慮しない。
 */
export function assessOvertimeRisk(input: {
  records: readonly WorkingRecord[];
  /** ここまでの実績の最終日（通常は昨日か今日） */
  asOf: LocalDate;
  monthEnd: LocalDate;
  thresholdMinutes: number;
}): OvertimeRisk {
  const summary = summarizeWorkingHours(input.records.filter((r) => r.date <= input.asOf));
  const soFar = summary.estimatedOvertimeMinutes;
  const remaining =
    input.asOf >= input.monthEnd ? 0 : countWeekdays(addDays(input.asOf, 1), input.monthEnd);
  const pace = summary.workDays === 0 ? 0 : soFar / summary.workDays;
  const projected = Math.round(soFar + pace * remaining);
  const level: RiskLevel =
    soFar >= input.thresholdMinutes
      ? 'over'
      : projected >= input.thresholdMinutes
        ? 'likely'
        : projected >= input.thresholdMinutes * WATCH_RATIO
          ? 'watch'
          : 'ok';
  return {
    overtimeSoFarMinutes: soFar,
    elapsedWorkDays: summary.workDays,
    remainingWorkDays: remaining,
    projectedOvertimeMinutes: projected,
    level,
  };
}
