import type { StampType } from '../api/stamps.ts';
import type { DayState } from './day-status.ts';

export type PunchCheck = { ok: true } | { ok: false; reason: string };

const ALLOWED: Record<DayState, readonly StampType[]> = {
  not_started: ['clock_in', 'direct_in'],
  working: ['break_start', 'clock_out', 'direct_out'],
  on_break: ['break_end'],
  finished: [],
};

/**
 * その日の状態と矛盾する打刻を見つける（ADR 0005）。
 * 例: 出勤済みなのに出勤、休憩中なのに退勤、未出勤なのに退勤。
 */
export function checkPunch(state: DayState, type: StampType): PunchCheck {
  if (ALLOWED[state].includes(type)) return { ok: true };
  return { ok: false, reason: reasonFor(state, type) };
}

function reasonFor(state: DayState, type: StampType): string {
  const isIn = type === 'clock_in' || type === 'direct_in';
  switch (state) {
    case 'not_started':
      return 'You have not clocked in today yet (未出勤).';
    case 'working':
      return isIn
        ? 'You have already clocked in today (勤務中).'
        : 'You are not on a break (勤務中).';
    case 'on_break':
      if (isIn) return 'You have already clocked in and are on a break (休憩中).';
      if (type === 'break_start') return 'You are already on a break (休憩中).';
      return 'You are on a break (休憩中). End the break (break_end / 休憩戻) first.';
    case 'finished':
      return 'You have already clocked out today (退勤済み).';
  }
}
