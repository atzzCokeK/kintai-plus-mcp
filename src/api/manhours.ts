import { type LocalDate, parseApiDate } from '../time/datetime.ts';

export interface ManhourItem {
  taskId: number;
  minutes: number;
}

export interface ManhourProject {
  projectId: number;
  totalMinutes: number;
  items: ManhourItem[];
}

export interface ManhourDay {
  staffId?: number;
  date: LocalDate;
  comment?: string;
  /** 締め済み（closed_at あり） */
  closed: boolean;
  /** 確定済み（fixed_at あり） */
  fixed: boolean;
  totalMinutes: number;
  projects: ManhourProject[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** 工数取得 API の応答を読む。`{ dates }`・`{ manhours: [{ staff_id, dates }] }`・配列を受け付ける */
export function parseManhours(value: unknown, staffId?: number): ManhourDay[] {
  const out: ManhourDay[] = [];
  collect(value, staffId, out);
  return out.sort((a, b) =>
    a.date === b.date ? (a.staffId ?? 0) - (b.staffId ?? 0) : a.date < b.date ? -1 : 1,
  );
}

function collect(value: unknown, staffId: number | undefined, out: ManhourDay[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, staffId, out);
    return;
  }
  if (!isRec(value)) return;
  const own = num(value.staff_id ?? value.staffId) ?? staffId;
  if (Array.isArray(value.dates)) {
    for (const d of value.dates) {
      const day = toDay(d, own);
      if (day) out.push(day);
    }
    return;
  }
  for (const key of ['manhours', 'staffs', 'response']) {
    if (key in value) collect(value[key], own, out);
  }
}

function toDay(raw: unknown, staffId: number | undefined): ManhourDay | undefined {
  if (!isRec(raw)) return undefined;
  const date = parseApiDate(typeof raw.date === 'string' ? raw.date : undefined);
  if (!date) return undefined;
  const projects: ManhourProject[] = [];
  for (const p of Array.isArray(raw.projects) ? raw.projects : []) {
    if (!isRec(p)) continue;
    const projectId = num(p.project_id ?? p.projectId);
    if (projectId === undefined) continue;
    const items: ManhourItem[] = [];
    for (const i of Array.isArray(p.daily_hour_items) ? p.daily_hour_items : []) {
      if (!isRec(i)) continue;
      const taskId = num(i.task_id ?? i.taskId);
      const minutes = num(i.minute ?? i.minutes);
      if (taskId !== undefined && minutes !== undefined) items.push({ taskId, minutes });
    }
    projects.push({ projectId, totalMinutes: sum(items.map((i) => i.minutes)), items });
  }
  const comment = typeof raw.comment === 'string' && raw.comment !== '' ? raw.comment : undefined;
  return {
    ...(staffId !== undefined ? { staffId } : {}),
    date,
    ...(comment ? { comment } : {}),
    closed: Boolean(raw.closed_at),
    fixed: Boolean(raw.fixed_at),
    totalMinutes: sum(projects.map((p) => p.totalMinutes)),
    projects,
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
