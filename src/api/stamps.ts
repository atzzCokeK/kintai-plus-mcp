import { parseApiDateTime } from '../time/datetime.ts';

/** 打刻種別（API の type）。省略時の自動判定は使わない（ADR 0005） */
export const STAMP_TYPE_CODES = {
  clock_in: 11, // 出勤
  clock_out: 12, // 退勤
  direct_in: 21, // 直行
  direct_out: 22, // 直帰
  break_start: 31, // 休憩入
  break_end: 32, // 休憩戻
} as const;

export type StampType = keyof typeof STAMP_TYPE_CODES;

export const STAMP_TYPE_LABEL: Record<StampType | 'unknown', string> = {
  clock_in: '出勤',
  clock_out: '退勤',
  direct_in: '直行',
  direct_out: '直帰',
  break_start: '休憩入',
  break_end: '休憩戻',
  unknown: '不明',
};

export function stampTypeFromCode(code: number): StampType | 'unknown' {
  for (const [name, value] of Object.entries(STAMP_TYPE_CODES)) {
    if (value === code) return name as StampType;
  }
  return 'unknown';
}

export interface Stamp {
  staffId?: number;
  stampedAt: Date;
  type: StampType | 'unknown';
  typeCode: number;
  /** 打刻方法・組織・位置情報など。AI に渡す前に privacy フィルタを通す */
  attributes: Record<string, unknown>;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 打刻取得 API の応答を読む。
 * 自分: `{ login_company_code, staff_id, count, stamps }`。
 * 複数従業員: `{ login_company_code, multiple_stamps: [{ staff_id, count, stamps }] }`。
 */
export function parseStamps(value: unknown, staffId?: number): Stamp[] {
  const out: Stamp[] = [];
  collect(value, staffId, out);
  return out.sort((a, b) => a.stampedAt.getTime() - b.stampedAt.getTime());
}

function collect(value: unknown, staffId: number | undefined, out: Stamp[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, staffId, out);
    return;
  }
  if (!isRec(value)) return;
  const ownStaffId = toNumber(value.staff_id ?? value.staffId) ?? staffId;
  if ('stamped_at' in value || 'stampedAt' in value) {
    const stamp = toStamp(value, ownStaffId);
    if (stamp) out.push(stamp);
    return;
  }
  const listKey = ['stamps', 'multiple_stamps', 'staffs', 'response'].find((key) => key in value);
  if (listKey) collect(value[listKey], ownStaffId, out);
}

function toStamp(raw: Rec, staffId: number | undefined): Stamp | undefined {
  const stampedAt = parseApiDateTime(String(raw.stamped_at ?? raw.stampedAt ?? ''));
  const typeCode = toNumber(raw.type);
  if (!stampedAt || typeCode === undefined) return undefined;
  const stamp: Stamp = {
    stampedAt,
    type: stampTypeFromCode(typeCode),
    typeCode,
    attributes: isRec(raw.attributes) ? { ...raw.attributes } : {},
  };
  if (staffId !== undefined) stamp.staffId = staffId;
  return stamp;
}

function toNumber(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}
