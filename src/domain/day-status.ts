import type { Stamp } from '../api/stamps.ts';

/** 未出勤 / 勤務中 / 休憩中 / 退勤済み */
export type DayState = 'not_started' | 'working' | 'on_break' | 'finished';

export const DAY_STATE_LABEL: Record<DayState, string> = {
  not_started: '未出勤',
  working: '勤務中',
  on_break: '休憩中',
  finished: '退勤済み',
};

export interface DayStatus {
  state: DayState;
  /** ここまでの勤務時間（休憩を除く、分） */
  workedMinutes: number;
  breakMinutes: number;
  firstClockInAt?: Date;
  lastClockOutAt?: Date;
  lastStamp?: Stamp;
  /**
   * countOpen: false のとき、退勤または休憩戻が無く、開いている区間を now まで数えていない。
   * 過去日を「勤務中」のまま日末まで数えないために使う。
   */
  unclosed?: 'clock_out' | 'break_end';
}

const MINUTE = 60_000;

export interface DayStatusOptions {
  /**
   * false のとき、勤務中・休憩中の開いている区間を now まで足さない。
   * 過去日の退勤漏れを、その日の終わりまでの勤務時間にしない。既定は true（今日の途中）。
   */
  countOpen?: boolean;
}

/** その日の打刻を順にたどって状態と時間を求める。ありえない並びの打刻は無視する。 */
export function computeDayStatus(
  stamps: readonly Stamp[],
  now: Date,
  options?: DayStatusOptions,
): DayStatus {
  const countOpen = options?.countOpen !== false;
  const sorted = [...stamps].sort((a, b) => a.stampedAt.getTime() - b.stampedAt.getTime());
  let state: DayState = 'not_started';
  let worked = 0;
  let breaks = 0;
  let since = 0;
  const status: Partial<DayStatus> = {};

  for (const stamp of sorted) {
    const t = stamp.stampedAt.getTime();
    switch (stamp.type) {
      case 'clock_in':
      case 'direct_in':
        if (state === 'not_started' || state === 'finished') {
          state = 'working';
          since = t;
          status.firstClockInAt ??= stamp.stampedAt;
        }
        break;
      case 'break_start':
        if (state === 'working') {
          worked += t - since;
          state = 'on_break';
          since = t;
        }
        break;
      case 'break_end':
        if (state === 'on_break') {
          breaks += t - since;
          state = 'working';
          since = t;
        }
        break;
      case 'clock_out':
      case 'direct_out':
        if (state === 'working') worked += t - since;
        if (state === 'on_break') breaks += t - since;
        if (state === 'working' || state === 'on_break') {
          state = 'finished';
          status.lastClockOutAt = stamp.stampedAt;
        }
        break;
      case 'unknown':
        break;
    }
  }

  const end = now.getTime();
  let unclosed: DayStatus['unclosed'];
  if (state === 'working') {
    if (countOpen) worked += Math.max(0, end - since);
    else unclosed = 'clock_out';
  }
  if (state === 'on_break') {
    if (countOpen) breaks += Math.max(0, end - since);
    else unclosed = 'break_end';
  }

  const result: DayStatus = {
    state,
    workedMinutes: Math.floor(worked / MINUTE),
    breakMinutes: Math.floor(breaks / MINUTE),
  };
  if (unclosed) result.unclosed = unclosed;
  if (status.firstClockInAt) result.firstClockInAt = status.firstClockInAt;
  if (status.lastClockOutAt) result.lastClockOutAt = status.lastClockOutAt;
  const last = sorted.at(-1);
  if (last) result.lastStamp = last;
  return result;
}
