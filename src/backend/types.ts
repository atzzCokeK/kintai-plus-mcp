import type { DateRange } from '../api/paging.ts';
import type { Role } from '../api/staff.ts';
import type { Stamp } from '../api/stamps.ts';

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
}

export interface StampList {
  stamps: Stamp[];
  /** API の件数上限に達して取りきれなかった */
  truncated: boolean;
}
