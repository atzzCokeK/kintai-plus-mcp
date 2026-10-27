import type { Alert } from '../api/alerts.ts';
import type { ManhourDay, ManhourItem } from '../api/manhours.ts';
import type { DateRange } from '../api/paging.ts';
import type { Project, ProjectMembers, Task } from '../api/projects.ts';
import type { Role, StaffSummary } from '../api/staff.ts';
import type { Stamp, StampType } from '../api/stamps.ts';
import type { WorkingRecord } from '../api/working-records.ts';
import type { WorkingStatus } from '../api/working-statuses.ts';
import type { LocalDate } from '../time/datetime.ts';

/**
 * 勤怠の操作を表すバックエンドのインターフェース。
 * ツールは API の形ではなく勤怠の概念で設計し、裏側（API 版・将来のブラウザ版）が増えても見た目を変えない（ADR 0001）。
 * 各バックエンドは対応する機能（capabilities）を申告し、それに応じて公開するツールが決まる。
 */
export const ALL_CAPABILITIES = [
  'profile',
  'stamps.read',
  'stamps.write',
  'working_records.read',
  'alerts.read',
  'projects.read',
  'manhours.read',
  'manhours.write',
  'staff.read',
  'team_stamps.read',
  'working_statuses.read',
  'project_members.read',
] as const;

export type Capability = (typeof ALL_CAPABILITIES)[number];

export interface Profile {
  staffId: number;
  name?: string;
  staffNum?: string;
  organizationName?: string;
  role: Role;
}

export interface KintaiBackend {
  readonly kind: 'api';
  readonly capabilities: ReadonlySet<Capability>;
  getMyProfile(): Promise<Profile>;
  /** 打刻履歴（両端の日を含む）。staffId を省略すると自分 */
  getStamps(range: DateRange, options?: { staffId?: number }): Promise<StampList>;
  /** 勤務実績（両端の日を含む）。staffIds を省略すると自分 */
  getWorkingRecords(range: DateRange, options?: { staffIds?: number[] }): Promise<WorkingRecord[]>;
  /** 自分のアラート（API では絞り込めない） */
  getAlerts(): Promise<Alert[]>;
  /** 企業のプロジェクト一覧 */
  listProjects(): Promise<{ projects: Project[]; truncated: boolean }>;
  listTasks(projectId: number): Promise<{ tasks: Task[]; truncated: boolean }>;
  /** 自分が参加しているプロジェクトの ID */
  getMyProjectIds(): Promise<number[]>;
  /** 工数（両端の日を含む）。staffId を省略すると自分 */
  getManhours(range: DateRange, options?: { staffId?: number }): Promise<ManhourDay[]>;
  /** 打刻する。記録はサーバー到着時刻で、API からは修正できない */
  punch(input: PunchInput): Promise<{ stampedAt?: Date }>;
  /** 自分の工数を作成・更新する */
  saveManhours(input: SaveManhoursInput): Promise<void>;
  /** 自分の工数を削除する。taskId を省略するとそのプロジェクトの全タスク */
  deleteManhours(input: { date: LocalDate; projectId: number; taskId?: number }): Promise<void>;

  // ---- 管理者向け ----
  /** 管理下の従業員の一覧 */
  listStaff(): Promise<{
    staff: StaffSummary[];
    totalCount: number | undefined;
    truncated: boolean;
  }>;
  /** 複数従業員の 1 日分の打刻 */
  getTeamStamps(date: LocalDate, staffIds: number[]): Promise<StampList>;
  /** 勤務処理（欠勤・出張など） */
  getWorkingStatuses(search: Array<{ staffId: number; date: LocalDate }>): Promise<WorkingStatus[]>;
  getProjectMembers(projectId: number): Promise<ProjectMembers>;
}

export interface SaveManhoursInput {
  date: LocalDate;
  projects: Array<{ projectId: number; items: ManhourItem[] }>;
}

export interface PunchInput {
  type: StampType;
  /** テレワーク（出勤時のみ有効） */
  telework?: boolean;
  /** 打刻する時刻（参考値として送る。記録はサーバー到着時刻） */
  at: Date;
}

export interface StampList {
  stamps: Stamp[];
  /** API の件数上限に達して取りきれなかった */
  truncated: boolean;
}
