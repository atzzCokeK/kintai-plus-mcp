import type { WorkingRecord } from '../api/working-records.ts';

/**
 * 経過時間（休憩を含む）から引く法定の最低休憩。
 * 労働基準法 34 条と同じく、6 時間・8 時間ちょうどは「超える」に含めない。
 * 実働に対する必要休憩（requiredBreakMinutes）とは別で、経過しか分からないときの見積もりに使う。
 */
export function statutoryBreakForElapsed(elapsedMinutes: number): number {
  if (elapsedMinutes > 8 * 60) return 60;
  if (elapsedMinutes > 6 * 60) return 45;
  return 0;
}

/** actual: API の実働 / break_results: 経過から休憩実績を引いた / statutory_minimum: 法定の最低休憩を引いた見積もり */
export type MinuteBasis = 'actual' | 'break_results' | 'statutory_minimum' | 'none';

export interface MinuteReading {
  /** 集計と残業の目安に使う分 */
  netMinutes: number;
  /** 開始〜終了の経過。見積もりのときだけ */
  elapsedMinutes?: number;
  basis: MinuteBasis;
  /** statutory_minimum のとき、引いた休憩 */
  assumedBreakMinutes?: number;
  breakMinutes?: number;
}

/**
 * API が返した実働（分）。経過からの見積もり（workingMinutesAreGross）は含めない。
 * 休憩不足の判定は、打刻の拘束時間ではなくこの値を使う。
 */
export function recordedNetMinutes(record: WorkingRecord | undefined): number | undefined {
  if (!record || record.workingMinutesAreGross === true) return undefined;
  const minutes = record.actualWorkingMinutes;
  if (minutes === undefined || minutes <= 0) return undefined;
  return minutes;
}

/** 勤務実績 1 日を、残業計算に使う実働（分）に読む。実働が無い日は見積もりだと basis で分かる。 */
export function readWorkingMinutes(record: WorkingRecord): MinuteReading {
  const raw = record.actualWorkingMinutes;
  if (raw === undefined || raw <= 0) {
    return {
      netMinutes: 0,
      basis: 'none',
      ...(record.breakMinutes !== undefined ? { breakMinutes: record.breakMinutes } : {}),
    };
  }
  if (record.workingMinutesAreGross !== true) {
    return {
      netMinutes: raw,
      basis: 'actual',
      ...(record.breakMinutes !== undefined ? { breakMinutes: record.breakMinutes } : {}),
    };
  }
  if (record.breakMinutes !== undefined) {
    return {
      netMinutes: Math.max(0, raw - record.breakMinutes),
      elapsedMinutes: raw,
      basis: 'break_results',
      breakMinutes: record.breakMinutes,
    };
  }
  const assumedBreakMinutes = statutoryBreakForElapsed(raw);
  return {
    netMinutes: Math.max(0, raw - assumedBreakMinutes),
    elapsedMinutes: raw,
    basis: 'statutory_minimum',
    assumedBreakMinutes,
  };
}
