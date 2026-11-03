import type { DateRange } from '../api/paging.ts';
import type { Stamp } from '../api/stamps.ts';
import type { WorkingRecord } from '../api/working-records.ts';
import { addDays, diffDays, endOfDay, type LocalDate, toLocalDate } from '../time/datetime.ts';
import { computeDayStatus } from './day-status.ts';

export type IssueType =
  | 'missing_clock_out'
  | 'missing_break_end'
  | 'missing_clock_in'
  | 'duplicate_clock_in'
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
export const MAX_OVERNIGHT_SHIFT_MINUTES = 16 * 60;

const SEVERITY: Record<IssueType, IssueSeverity> = {
  missing_clock_out: 'error',
  missing_break_end: 'error',
  missing_clock_in: 'error',
  duplicate_clock_in: 'error',
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
 * 打刻漏れは打刻と、勤務実績の出勤・退勤打刻時刻（clockInAt / clockOutAt）で判断する。
 * 実績の開始・終了（startTime / endTime）だけでは、システムが埋めた時刻なので打刻漏れを消さない。
 * 退勤打刻が勤務日の当日でも、翌日かつ出勤から 16 時間以内でもないときは、その日の退勤にしない。
 * 退勤より前にもう一度出勤している日は duplicate_clock_in。出勤が無く休憩や退勤だけの日は missing_clock_in。
 * 前日の終了と当日の開始が勤務実績にあれば、インターバルは打刻より実績を優先する（夜勤の終了時刻を短いインターバルにしない）。
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
    const record = recordByDate.get(open.date);
    // 退勤打刻がその日を閉じているときだけ、打刻漏れを消す。開始・終了時刻では消さない。
    if (clockOutClosesDay(record)) return;
    if (open.type === 'missing_clock_out') {
      const wrongDay = wrongDayClockOut(record);
      if (wrongDay) {
        add(open.date, 'missing_clock_out', wrongDay);
        return;
      }
    }
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
    const continued = continuesOpenShift(pending, date, stamps);
    if (pending && !continued) reportOpenPunch(pending);
    const carried = continued ? pending : undefined;
    pending = undefined;

    const shape = scanDayPunches(stamps, carried !== undefined);
    if (shape.duplicate) {
      add(
        date,
        'duplicate_clock_in',
        '出勤の打刻が重複しています（退勤より前にもう一度出勤しています）',
      );
    }
    if (shape.missingClockIn && !sameDayClockIn(record)) {
      add(date, 'missing_clock_in', shape.missingClockInMessage);
    } else if (
      record?.clockOutAt &&
      !sameDayClockIn(record) &&
      !stamps.some(isIn) &&
      !shape.missingClockIn
    ) {
      add(date, 'missing_clock_in', '出勤の打刻がないまま退勤しています');
    }

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
    // 出勤打刻が無く、別日の退勤打刻だけがある。pending にならないのでここで出す。
    const wrongDay = wrongDayClockOut(record);
    if (wrongDay && status.state !== 'working' && status.state !== 'on_break') {
      add(date, 'missing_clock_out', wrongDay);
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

    const prevRecord = recordByDate.get(addDays(date, -1));
    const recordGap = shiftGapMinutes(prevRecord, record);
    if (recordGap !== undefined) {
      if (recordGap >= 0 && recordGap < MIN_INTERVAL_MINUTES) {
        add(
          date,
          'short_interval',
          `前日の退勤から ${formatHm(recordGap)} で出勤しています（勤務実績の時刻。勤務間インターバル 11 時間未満）`,
        );
      }
    } else {
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

/** 退勤で閉じていない勤務のあいだに、もう一度出勤しているか。出勤無しの休憩・退勤か。 */
function scanDayPunches(
  stamps: readonly Stamp[],
  continued: boolean,
): { duplicate: boolean; missingClockIn: boolean; missingClockInMessage: string } {
  let inShift = continued;
  let sawBreakStart = false;
  let sawBreakEnd = false;
  let sawOut = false;
  let duplicate = false;
  let missing = false;
  for (const stamp of stamps) {
    if (isIn(stamp)) {
      if (inShift) duplicate = true;
      inShift = true;
    } else if (stamp.type === 'break_start') {
      if (!inShift) {
        missing = true;
        sawBreakStart = true;
      }
    } else if (stamp.type === 'break_end') {
      if (!inShift) {
        missing = true;
        sawBreakEnd = true;
      }
    } else if (isOut(stamp)) {
      if (!inShift) {
        missing = true;
        sawOut = true;
      } else {
        inShift = false;
      }
    }
  }
  return {
    duplicate,
    missingClockIn: missing,
    missingClockInMessage: missingInMessage(sawBreakStart, sawBreakEnd, sawOut),
  };
}

function missingInMessage(sawBreakStart: boolean, sawBreakEnd: boolean, sawOut: boolean): string {
  if ((sawBreakStart || sawBreakEnd) && sawOut) {
    return '出勤の打刻がないまま休憩または退勤しています';
  }
  if (sawBreakEnd) return '出勤の打刻がないまま休憩戻しています';
  if (sawBreakStart) return '出勤の打刻がないまま休憩入しています';
  return '出勤の打刻がないまま退勤しています';
}

/** 前日の実績終了から当日の実績開始まで（分）。どちらかの時刻が無いときは undefined。 */
function shiftGapMinutes(
  prev: WorkingRecord | undefined,
  current: WorkingRecord | undefined,
): number | undefined {
  const end = prev?.endTime ?? prev?.clockOutAt;
  const start = current?.startTime ?? current?.clockInAt;
  if (!end || !start) return undefined;
  return Math.round((start.getTime() - end.getTime()) / 60_000);
}

/** その勤務日の出勤打刻。開始時刻（startTime）はシステムが埋めるので使わない。 */
function sameDayClockIn(record: WorkingRecord | undefined): boolean {
  return record?.clockInAt !== undefined && toLocalDate(record.clockInAt) === record.date;
}

/**
 * 退勤打刻がその勤務日を閉じているか。
 * 当日か、出勤打刻から 16 時間以内の翌日だけ。開始・終了時刻では閉じない。
 */
function clockOutClosesDay(record: WorkingRecord | undefined): boolean {
  if (!record?.clockOutAt) return false;
  const outDate = toLocalDate(record.clockOutAt);
  if (outDate === record.date) return true;
  if (outDate !== addDays(record.date, 1) || !sameDayClockIn(record) || !record.clockInAt) {
    return false;
  }
  const elapsed = record.clockOutAt.getTime() - record.clockInAt.getTime();
  return elapsed >= 0 && elapsed <= MAX_OVERNIGHT_SHIFT_MINUTES * 60_000;
}

function wrongDayClockOut(record: WorkingRecord | undefined): string | undefined {
  if (!record?.clockOutAt || clockOutClosesDay(record)) return undefined;
  return `退勤打刻が勤務日と別の日（${toLocalDate(record.clockOutAt)}）になっています`;
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
