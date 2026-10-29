import { type LocalDate, parseApiDate, parseApiDateTime, startOfDay } from '../time/datetime.ts';

/** 労働区分: 0 労働日 / 1 所定休日 / 2 法定休日 */
export type DayCategory = 'workday' | 'scheduled_holiday' | 'legal_holiday' | 'unknown';

export const DAY_CATEGORY_LABEL: Record<DayCategory, string> = {
  workday: '労働日',
  scheduled_holiday: '所定休日',
  legal_holiday: '法定休日',
  unknown: '不明',
};

export interface WorkingRecord {
  staffId?: number;
  date: LocalDate;
  dayCategory: DayCategory;
  /** 勤務開始・終了（start_time / end_time） */
  startTime?: Date;
  endTime?: Date;
  /** 出勤・退勤の打刻時刻（attendance_punch_time / leaving_punch_time） */
  clockInAt?: Date;
  clockOutAt?: Date;
  /**
   * 実働時間（分）。API は実働を返さないので、無いときは開始〜終了（無ければ rounded_*）の経過。
   * その場合は休憩を含み、`workingMinutesAreGross` が true。
   */
  actualWorkingMinutes?: number;
  /** true のとき actualWorkingMinutes は休憩を含む経過時間 */
  workingMinutesAreGross?: boolean;
  /** 休憩（分）。API が休憩を返さないときは undefined（0 とは区別する） */
  breakMinutes?: number;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const MINUTE = 60_000;

/**
 * 勤務実績 API の応答を読む。
 * `response` は `[{ staff_id, working_records: [...] }]`。
 * 各レコードに実働・休憩は無く、時刻は `yyyy/mm/dd HH:MM:SS`（終了が翌日以降の夜勤もある）。
 */
export function parseWorkingRecords(value: unknown, staffId?: number): WorkingRecord[] {
  const out: WorkingRecord[] = [];
  collect(value, staffId, out);
  return out.sort((a, b) =>
    a.date === b.date ? (a.staffId ?? 0) - (b.staffId ?? 0) : a.date < b.date ? -1 : 1,
  );
}

function collect(value: unknown, staffId: number | undefined, out: WorkingRecord[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, staffId, out);
    return;
  }
  if (!isRec(value)) return;
  const ownStaffId = toNumber(value.staff_id ?? value.staffId) ?? staffId;
  if ('date' in value && ('working_day_category' in value || 'start_time' in value)) {
    const record = toRecord(value, ownStaffId);
    if (record) out.push(record);
    return;
  }
  for (const key of ['working_records', 'workingRecords', 'records', 'staffs', 'response']) {
    if (key in value) collect(value[key], ownStaffId, out);
  }
}

function toRecord(raw: Rec, staffId: number | undefined): WorkingRecord | undefined {
  const date = parseApiDate(typeof raw.date === 'string' ? raw.date : undefined);
  if (!date) return undefined;
  const record: WorkingRecord = { date, dayCategory: dayCategory(raw.working_day_category) };
  if (staffId !== undefined) record.staffId = staffId;
  const set = (key: 'startTime' | 'endTime' | 'clockInAt' | 'clockOutAt', v: unknown) => {
    const t = timeOnDate(v, date);
    if (t) record[key] = t;
  };
  set('startTime', raw.start_time);
  set('endTime', raw.end_time);
  set('clockInAt', raw.attendance_punch_time);
  set('clockOutAt', raw.leaving_punch_time);
  const actual = minutes(raw.actual_working_hours_no_rounding);
  if (actual !== undefined) {
    record.actualWorkingMinutes = actual;
  } else {
    const gross =
      elapsedMinutes(record.startTime, record.endTime) ??
      elapsedMinutes(
        timeOnDate(raw.rounded_start_time, date),
        timeOnDate(raw.rounded_end_time, date),
      );
    if (gross !== undefined) {
      record.actualWorkingMinutes = gross;
      record.workingMinutesAreGross = true;
    }
  }
  if (Array.isArray(raw.break_time_results)) {
    record.breakMinutes = raw.break_time_results.reduce<number>(
      (sum, b) => sum + breakMinutes(b, date),
      0,
    );
  }
  return record;
}

function elapsedMinutes(start: Date | undefined, end: Date | undefined): number | undefined {
  if (!start || !end) return undefined;
  const minutes = Math.round((end.getTime() - start.getTime()) / MINUTE);
  return minutes >= 0 ? minutes : undefined;
}

function dayCategory(v: unknown): DayCategory {
  switch (toNumber(v)) {
    case 0:
      return 'workday';
    case 1:
      return 'scheduled_holiday';
    case 2:
      return 'legal_holiday';
    default:
      return 'unknown';
  }
}

const TIME_ONLY = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** 日時、または時刻だけ（24 時以降も可）の値を、その日の時刻として読む */
function timeOnDate(v: unknown, date: LocalDate): Date | undefined {
  if (typeof v !== 'string' || v === '') return undefined;
  const full = parseApiDateTime(v);
  if (full) return full;
  const m = TIME_ONLY.exec(v.trim());
  if (!m) return undefined;
  const offset = (Number(m[1]) * 60 + Number(m[2])) * MINUTE + Number(m[3] ?? 0) * 1000;
  return new Date(startOfDay(date).getTime() + offset);
}

/** 分（数値）または "H:MM" を分にする */
function minutes(v: unknown): number | undefined {
  if (typeof v === 'string') {
    const m = TIME_ONLY.exec(v.trim());
    if (m) return Number(m[1]) * 60 + Number(m[2]);
  }
  return toNumber(v);
}

function breakMinutes(b: unknown, date: LocalDate): number {
  if (!isRec(b)) return minutes(b) ?? 0;
  const start = timeOnDate(b.start_time ?? b.start, date);
  const end = timeOnDate(b.end_time ?? b.end, date);
  if (start && end) return Math.max(0, Math.round((end.getTime() - start.getTime()) / MINUTE));
  return minutes(b.break_time ?? b.minutes ?? b.time) ?? 0;
}

function toNumber(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}
