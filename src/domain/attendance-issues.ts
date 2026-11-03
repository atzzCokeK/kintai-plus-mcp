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
/**
 * 休憩が不明な経過時間から差し引く幅（分）。
 * 8 時間超の法定休憩は 1 時間。これを引いても 12 時間を超えるときだけ警告にする。
 */
const UNKNOWN_BREAK_ALLOWANCE_MINUTES = 60;
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
 * 日をまたぐ勤務は 1 つの勤務として扱い、打刻漏れにしない。
 * 前日が勤務中のままなら、翌日の最初の出退勤が退勤（休憩の打刻は間にあってよい）で閉じる。
 * 前日が休憩中のままなら、翌日が休憩戻か退勤で始まるときに閉じる。
 * 範囲の前後 1 日も見る（初日の朝・末日の翌朝に終わる夜勤）。その外の問題は出さない。
 * stamps には範囲の前日と翌日の分も含めてよい。
 * 休暇・申請は API で見えないため、「労働日に打刻なし」は休暇の可能性を添えて warning にとどめる。
 * 勤務実績に開始・終了（または出勤・退勤の打刻時刻）がある日は、打刻修正などで打刻が欠けていても打刻漏れにしない。
 * 休憩が不明な経過時間は 12 時間超を info にし、1 時間引いても超えるときだけ warning にする。
 */
export function findAttendanceIssues(input: {
  range: DateRange;
  records: readonly WorkingRecord[];
  stamps: readonly Stamp[];
}): AttendanceIssue[] {
  const issues: AttendanceIssue[] = [];
  const add = (date: LocalDate, type: IssueType, message: string, severity = SEVERITY[type]) =>
    issues.push({ date, type, severity, message });
  const reportOpenPunch = (open: {
    date: LocalDate;
    type: 'missing_clock_out' | 'missing_break_end';
  }) => {
    // 終了時刻がある勤務実績は、打刻修正でその日が閉じているとみなす（休憩の内訳は API に無い）
    if (recordHasClockOut(recordByDate.get(open.date))) return;
    add(
      open.date,
      open.type,
      open.type === 'missing_clock_out'
        ? '退勤の打刻がありません（打刻忘れの可能性）'
        : '休憩戻の打刻がありません（休憩中のまま）',
    );
  };

  const stampsByDate = new Map<LocalDate, Stamp[]>();
  for (const stamp of [...input.stamps].sort(
    (a, b) => a.stampedAt.getTime() - b.stampedAt.getTime(),
  )) {
    const date = toLocalDate(stamp.stampedAt);
    stampsByDate.set(date, [...(stampsByDate.get(date) ?? []), stamp]);
  }
  const recordByDate = new Map(input.records.map((r) => [r.date, r]));

  // 範囲の前日と翌日も見て、端の夜勤を扱う（範囲外の問題は最後に除く）
  const start = addDays(input.range.from, -1);
  const end = addDays(input.range.to, 1);
  let pending: OpenPunch | undefined;
  let previousOut: { date: LocalDate; at: Date } | undefined;
  const days = diffDays(start, end) + 1;

  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const stamps = stampsByDate.get(date) ?? [];
    const record = recordByDate.get(date);
    const firstInOrOut = stamps.find((s) => isIn(s) || isOut(s));
    const startsWithOut = firstInOrOut !== undefined && isOut(firstInOrOut);

    const continued = continuesOpenShift(pending, date, stamps);
    if (pending && !continued) reportOpenPunch(pending);
    const carried = continued ? pending : undefined;
    pending = undefined;

    if (startsWithOut && !continued && !recordHasClockIn(record))
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
    if (status.state === 'on_break') {
      pending = {
        date,
        type: 'missing_break_end',
        ...(lastIn ? { lastInAt: lastIn.stampedAt } : {}),
      };
    }
    // 日付をまたいだあとも退勤が無い。この日の打刻だけでは昨日の出勤が見えない
    if (carried && !stamps.some(isOut) && status.state === 'not_started') {
      pending = {
        date: carried.date,
        type: 'missing_clock_out',
        ...(carried.lastInAt ? { lastInAt: carried.lastInAt } : {}),
      };
    }

    const minutes = record?.actualWorkingMinutes ?? 0;
    if (record?.dayCategory === 'workday' && stamps.length === 0 && minutes === 0 && !continued) {
      add(
        date,
        'no_punches_on_workday',
        '労働日ですが打刻がありません（休暇などの場合は問題ありません）',
      );
    }
    if (minutes > LONG_DAY_MINUTES) {
      addLongDay(date, minutes, record?.workingMinutesAreGross === true, add);
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
      add(
        date,
        'holiday_work',
        holidayWorkMessage('法定休日', minutes, record.workingMinutesAreGross),
      );
    } else if (minutes > 0 && record?.dayCategory === 'scheduled_holiday') {
      add(
        date,
        'holiday_work',
        holidayWorkMessage('所定休日', minutes, record.workingMinutesAreGross),
      );
    }
  }
  if (pending) reportOpenPunch(pending);
  return issues
    .filter((issue) => issue.date >= input.range.from && issue.date <= input.range.to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

type OpenPunch = {
  date: LocalDate;
  type: 'missing_clock_out' | 'missing_break_end';
  lastInAt?: Date;
};

/**
 * 前日の勤務がこの日の打刻で続いているか。
 * 出勤から 16 時間以内だけを同じ勤務とみなす。
 */
function continuesOpenShift(
  pending: OpenPunch | undefined,
  date: LocalDate,
  stamps: readonly Stamp[],
): boolean {
  if (!pending?.lastInAt || diffDays(pending.date, date) !== 1) return false;
  const within = (at: Date) =>
    at.getTime() - (pending.lastInAt?.getTime() ?? 0) <= MAX_OVERNIGHT_SHIFT_MINUTES * 60_000;
  if (pending.type === 'missing_clock_out') {
    const firstInOrOut = stamps.find((s) => isIn(s) || isOut(s));
    return firstInOrOut !== undefined && isOut(firstInOrOut) && within(firstInOrOut.stampedAt);
  }
  const first = stamps.find((s) => s.type === 'break_end' || isIn(s) || isOut(s));
  if (!first || !within(first.stampedAt)) return false;
  return first.type === 'break_end' || isOut(first);
}

function recordHasClockIn(record: WorkingRecord | undefined): boolean {
  return record?.startTime !== undefined || record?.clockInAt !== undefined;
}

function recordHasClockOut(record: WorkingRecord | undefined): boolean {
  return record?.endTime !== undefined || record?.clockOutAt !== undefined;
}

function addLongDay(
  date: LocalDate,
  minutes: number,
  gross: boolean,
  add: (date: LocalDate, type: IssueType, message: string, severity?: IssueSeverity) => void,
): void {
  if (!gross) {
    add(date, 'long_working_day', `実働が ${formatHm(minutes)} で、12 時間を超えています`);
    return;
  }
  const elapsed = `開始から終了までの経過が ${formatHm(minutes)}`;
  if (minutes > LONG_DAY_MINUTES + UNKNOWN_BREAK_ALLOWANCE_MINUTES) {
    add(
      date,
      'long_working_day',
      `${elapsed} です。1 時間の休憩を差し引いても 12 時間を超えます（実際の休憩時間は不明）`,
    );
    return;
  }
  add(
    date,
    'long_working_day',
    `${elapsed} で 12 時間を超えています。休憩時間が不明なため、実働はこれより短い可能性があります`,
    'info',
  );
}

function holidayWorkMessage(kind: string, minutes: number, gross: boolean | undefined): string {
  const base = `${kind}に ${formatHm(minutes)} 働いています`;
  return gross ? `${base}（開始から終了までの経過。休憩は不明）` : base;
}

function formatHm(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
