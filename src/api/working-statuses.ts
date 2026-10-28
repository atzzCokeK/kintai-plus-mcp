import { type LocalDate, parseApiDate } from '../time/datetime.ts';

/** 勤務処理（欠勤・出張など、企業ごとに設定されたラベル） */
export interface WorkingStatus {
  staffId: number;
  date: LocalDate;
  labels: string[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

const LABEL_KEYS = ['name', 'label', 'status_name', 'working_status_name', 'title'];
const LIST_KEYS = ['working_statuses', 'workingStatuses', 'statuses'];

/** 勤務処理取得 API の応答を読む。形が一次情報で確認できていないため、ラベルの置き場所に寛容にする */
export function parseWorkingStatuses(value: unknown): WorkingStatus[] {
  const items = Array.isArray(value)
    ? value
    : isRec(value)
      ? (LIST_KEYS.map((k) => value[k]).find(Array.isArray) ?? [])
      : [];
  const out: WorkingStatus[] = [];
  for (const item of items as unknown[]) {
    if (!isRec(item)) continue;
    const staffId = Number(item.staff_id ?? item.staffId);
    const date = parseApiDate(typeof item.date === 'string' ? item.date : undefined);
    if (!Number.isFinite(staffId) || !date) continue;
    out.push({ staffId, date, labels: labelsOf(item) });
  }
  return out;
}

function labelsOf(item: Rec): string[] {
  const nested = LIST_KEYS.map((k) => item[k]).find(Array.isArray) as unknown[] | undefined;
  if (nested)
    return nested.flatMap((n) => (typeof n === 'string' ? [n] : isRec(n) ? labelOf(n) : []));
  return labelOf(item);
}

function labelOf(rec: Rec): string[] {
  for (const key of LABEL_KEYS) {
    const v = rec[key];
    if (typeof v === 'string' && v !== '') return [v];
  }
  return [];
}
