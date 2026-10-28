import { type LocalDate, parseApiDate } from '../time/datetime.ts';

export interface Project {
  projectId: number;
  name: string;
  shortName?: string;
  code?: string;
  startDate?: LocalDate;
  endDate?: LocalDate;
}

export interface Task {
  taskId: number;
  name: string;
  code?: string;
  /** 見積もり時間（分） */
  estimatedMinutes?: number;
  finished: boolean;
}

export interface ProjectMembers {
  staffIds: number[];
  ownerStaffIds: number[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/** `{ key: [...] }` または配列そのものから配列を取り出す */
export function listOf(value: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRec(value)) {
    for (const key of keys) if (Array.isArray(value[key])) return value[key] as unknown[];
  }
  return [];
}

export function readTotalCount(value: unknown): number | undefined {
  if (!isRec(value)) return undefined;
  return num(value.TotalCount ?? value.total_count ?? value.totalCount);
}

export function parseProjects(value: unknown): Project[] {
  const out: Project[] = [];
  for (const item of listOf(value, 'projects')) {
    if (!isRec(item)) continue;
    const projectId = num(item.project_id ?? item.projectId);
    if (projectId === undefined) continue;
    const project: Project = { projectId, name: str(item.name) ?? `Project ${projectId}` };
    const shortName = str(item.short_name ?? item.shortName);
    if (shortName) project.shortName = shortName;
    const code = str(item.project_code ?? item.projectCode ?? item.code);
    if (code) project.code = code;
    const startDate = parseApiDate(str(item.start_date ?? item.startDate));
    if (startDate) project.startDate = startDate;
    const endDate = parseApiDate(str(item.end_date ?? item.endDate));
    if (endDate) project.endDate = endDate;
    out.push(project);
  }
  return out;
}

export function parseTasks(value: unknown): Task[] {
  const out: Task[] = [];
  for (const item of listOf(value, 'tasks')) {
    if (!isRec(item)) continue;
    const taskId = num(item.task_id ?? item.taskId);
    if (taskId === undefined) continue;
    const code = str(item.code ?? item.task_code);
    const estimated = num(item.estimated_hour ?? item.estimatedHour);
    out.push({
      taskId,
      name: str(item.name) ?? `Task ${taskId}`,
      ...(code ? { code } : {}),
      ...(estimated !== undefined ? { estimatedMinutes: estimated } : {}),
      finished: item.is_finished === true || item.isFinished === true,
    });
  }
  return out;
}

/** 参加プロジェクト API の応答から、プロジェクト ID を取り出す */
export function parseStaffProjectIds(value: unknown): number[] {
  const ids: number[] = [];
  for (const item of listOf(value, 'project_ids', 'projectIds', 'projects', 'staff_projects')) {
    const id = isRec(item) ? num(item.project_id ?? item.projectId) : num(item);
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function parseProjectMembers(value: unknown): ProjectMembers {
  const ids = (v: unknown) => (Array.isArray(v) ? v.map(num).filter((n) => n !== undefined) : []);
  if (!isRec(value)) return { staffIds: [], ownerStaffIds: [] };
  return {
    staffIds: ids(value.staff_ids ?? value.staffIds),
    ownerStaffIds: ids(value.owner_staff_ids ?? value.ownerStaffIds),
  };
}
