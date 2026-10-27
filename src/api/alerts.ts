import { type LocalDate, parseApiDate } from '../time/datetime.ts';

/** アラート種別（api-notes に記載のあるもの。23 は欠番） */
const ALERT_LABELS: Record<number, string> = {
  1: '打刻忘れ',
  2: '欠勤疑い',
  3: '休憩過小/超過',
  6: '休日出勤',
  7: '遅刻',
  8: '早退',
  9: '残業時間閾値超え',
  11: '深夜労働',
  13: '36協定',
  14: 'インターバル',
  22: '工数未入力',
  28: '休憩時間不足',
};

export function alertLabel(type: number): string {
  return ALERT_LABELS[type] ?? `その他（種別 ${type}）`;
}

export interface Alert {
  /** YYYY-MM */
  month?: string;
  date?: LocalDate;
  type: number;
  label: string;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseAlerts(value: unknown): Alert[] {
  const items = Array.isArray(value)
    ? value
    : isRec(value) && Array.isArray(value.alerts)
      ? value.alerts
      : [];
  const alerts: Alert[] = [];
  for (const item of items) {
    if (!isRec(item)) continue;
    const type = Number(item.alert_type ?? item.alertType);
    if (!Number.isFinite(type)) continue;
    const month = parseMonth(item.month);
    const date = parseApiDate(typeof item.date === 'string' ? item.date : undefined);
    alerts.push({
      ...(month ? { month } : {}),
      ...(date ? { date } : {}),
      type,
      label: alertLabel(type),
    });
  }
  const key = (a: Alert) => a.date ?? `${a.month ?? ''}-00`;
  return alerts.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.type - b.type));
}

function parseMonth(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^(\d{4})[/-]?(\d{2})$/.exec(v.trim());
  return m ? `${m[1]}-${m[2]}` : undefined;
}
