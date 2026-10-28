import type { DateRange } from '../api/paging.ts';
import type { Stamp } from '../api/stamps.ts';
import type { WorkingRecord } from '../api/working-records.ts';
import { addDays, diffDays, endOfDay, type LocalDate, toLocalDate } from '../time/datetime.ts';
import { computeDayStatus } from './day-status.ts';

export type IssueType =
  | 'missing_clock_out'
  | 'missing_break_end'
  | 'missing_clock_in'
  | 'no_punches_on_workday'
  | 'long_working_day'
  | 'short_interval'
  | 'holiday_work';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface AttendanceIssue {
  date: LocalDate;
  type: IssueType;
  severity: IssueSeverity;
  message: string;
}

/** 長時間労働とみなす 1 日の実働（分） */
const LONG_DAY_MINUTES = 12 * 60;
/** 勤務間インターバルの目安（分） */
const MIN_INTERVAL_MINUTES = 11 * 60;
/** 日をまたぐ勤務とみなす、出勤から翌日の退勤までの最長（分） */
const MAX_OVERNIGHT_SHIFT_MINUTES = 16 * 60;

const SEVERITY: Record<IssueType, IssueSeverity> = {
  missing_clock_out: 'error',
  missing_break_end: 'error',
  missing_clock_in: 'error',
  no_punches_on_workday: 'warning',
  long_working_day: 'warning',
  short_interval: 'warning',
  holiday_work: 'info',
};

const isIn = (s: Stamp) => s.type === 'clock_in' || s.type === 'direct_in';
const isOut = (s: Stamp) => s.type === 'clock_out' || s.type === 'direct_out';

/**
 * 打刻と勤務実績から、打刻漏れなどの気になる点を探す。
 * 日をまたぐ勤務（前日に出勤し、翌日の最初の打刻が退勤）は 1 つの勤務として扱い、打刻漏れにしない。
 * 範囲の初日の朝に終わる夜勤のため、stamps には範囲の前日の分も含めてよい。
 * 休暇・申請は API で見えないため、「労働日に打刻なし」は休暇の可能性を添えて warning にとどめる。
 */
export function findAttendanceIssues(input: {
  range: DateRange;
  records: readonly WorkingRecord[];
  stamps: readonly Stamp[];
}): AttendanceIssue[] {
  const issues: AttendanceIssue[] = [];
  const add = (date: LocalDate, type: IssueType, message: string) =>
    issues.push({ date, type, severity: SEVERITY[type], message });

  const stampsByDate = new Map<LocalDate, Stamp[]>();
  for (const stamp of [...input.stamps].sort(
    (a, b) => a.stampedAt.getTime() - b.stampedAt.getTime(),
  )) {
    const date = toLocalDate(stamp.stampedAt);
    stampsByDate.set(date, [...(stampsByDate.get(date) ?? []), stamp]);
  }
  const recordByDate = new Map(input.records.map((r) => [r.date, r]));

  // 範囲の前日から見て、初日の朝に終わる夜勤を扱う（前日の問題は最後に除く）
  const start = addDays(input.range.from, -1);
  let pending:
    | { date: LocalDate; type: 'missing_clock_out' | 'missing_break_end'; lastInAt?: Date }
    | undefined;
  let previousOut: { date: LocalDate; at: Date } | undefined;
  const days = diffDays(start, input.range.to) + 1;

  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const stamps = stampsByDate.get(date) ?? [];
    const record = recordByDate.get(date);
    const firstInOrOut = stamps.find((s) => isIn(s) || isOut(s));
    const startsWithOut = firstInOrOut !== undefined && isOut(firstInOrOut);

    // 前日が勤務中のまま終わり、この日の最初の打刻が退勤（16 時間以内）なら日をまたぐ勤務
    const overnight =
      pending?.type === 'missing_clock_out' &&
      pending.lastInAt !== undefined &&
      diffDays(pending.date, date) === 1 &&
      startsWithOut &&
      firstInOrOut.stampedAt.getTime() - pending.lastInAt.getTime() <=
        MAX_OVERNIGHT_SHIFT_MINUTES * 60_000;
    if (pending && !overnight) {
      add(
        pending.date,
        pending.type,
        pending.type === 'missing_clock_out'
          ? '退勤の打刻がありません（打刻忘れの可能性）'
          : '休憩戻の打刻がありません（休憩中のまま）',
      );
    }
    pending = undefined;

    if (startsWithOut && !overnight)
      add(date, 'missing_clock_in', '出勤の打刻がないまま退勤しています');

    const status = computeDayStatus(stamps, endOfDay(date));
    const lastIn = [...stamps].reverse().find(isIn);
    if (status.state === 'working') {
      pending = {
        date,
        type: 'missing_clock_out',
        ...(lastIn ? { lastInAt: lastIn.stampedAt } : {}),
      };
    }
    if (status.state === 'on_break') pending = { date, type: 'missing_break_end' };

    const minutes = record?.actualWorkingMinutes ?? 0;
    if (record?.dayCategory === 'workday' && stamps.length === 0 && minutes === 0 && !overnight) {
      add(
        date,
        'no_punches_on_workday',
        '労働日ですが打刻がありません（休暇などの場合は問題ありません）',
      );
    }
    if (minutes > LONG_DAY_MINUTES) {
      add(date, 'long_working_day', `実働が ${formatHm(minutes)} で、12 時間を超えています`);
    }

    const firstIn = stamps.find(isIn);
    if (previousOut && firstIn && diffDays(previousOut.date, date) === 1) {
      const gap = Math.round((firstIn.stampedAt.getTime() - previousOut.at.getTime()) / 60_000);
      if (gap >= 0 && gap < MIN_INTERVAL_MINUTES) {
        add(
          date,
          'short_interval',
          `前日の退勤から ${formatHm(gap)} で出勤しています（勤務間インターバル 11 時間未満）`,
        );
      }
    }
    const lastOut = [...stamps].reverse().find(isOut);
    previousOut = lastOut ? { date, at: lastOut.stampedAt } : undefined;

    if (minutes > 0 && record?.dayCategory === 'legal_holiday') {
      add(date, 'holiday_work', `法定休日に ${formatHm(minutes)} 働いています`);
    } else if (minutes > 0 && record?.dayCategory === 'scheduled_holiday') {
      add(date, 'holiday_work', `所定休日に ${formatHm(minutes)} 働いています`);
    }
  }
  if (pending) {
    add(
      pending.date,
      pending.type,
      pending.type === 'missing_clock_out'
        ? '退勤の打刻がありません（打刻忘れの可能性）'
        : '休憩戻の打刻がありません（休憩中のまま）',
    );
  }
  return issues
    .filter((issue) => issue.date >= input.range.from)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function formatHm(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
