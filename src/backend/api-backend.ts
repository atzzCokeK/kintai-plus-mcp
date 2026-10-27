import { type Alert, parseAlerts } from '../api/alerts.ts';
import type { KintaiApiClient } from '../api/client.ts';
import { COMPANY_ID } from '../api/endpoint.ts';
import { type ManhourDay, parseManhours } from '../api/manhours.ts';
import { chunk, type DateRange, paginate, splitByDays, splitByMonths } from '../api/paging.ts';
import {
  type Project,
  parseProjects,
  parseStaffProjectIds,
  parseTasks,
  readTotalCount,
  type Task,
} from '../api/projects.ts';
import { fetchMyStaff, permissionRole } from '../api/staff.ts';
import { parseStamps, STAMP_TYPE_CODES, type Stamp } from '../api/stamps.ts';
import { parseWorkingRecords, type WorkingRecord } from '../api/working-records.ts';
import {
  diffDays,
  endOfDay,
  formatCompactDate,
  formatSlashDate,
  formatSlashDateTime,
  formatStampQuery,
  JST_OFFSET,
  type LocalDate,
  startOfDay,
} from '../time/datetime.ts';
import {
  ALL_CAPABILITIES,
  type Capability,
  type KintaiBackend,
  type Profile,
  type PunchInput,
  type SaveManhoursInput,
  type StampList,
} from './types.ts';

/** 打刻取得の制約: 期間は最長 6 ヶ月、1 回 1000 件まで */
const STAMP_MAX_MONTHS = 6;
const STAMP_MAX_RECORDS = 1000;
/** 1 回のツール呼び出しで打刻 API を呼ぶ回数の上限 */
const STAMP_MAX_REQUESTS = 12;
/** 勤務実績の制約: 期間は最長 31 日 */
const WORKING_RECORD_MAX_DAYS = 31;
/** 1 リクエストで指定する従業員数（上限は未確認のため控えめに） */
const WORKING_RECORD_STAFF_PER_REQUEST = 50;
/** プロジェクト・タスク一覧: 50 件/ページ */
const PROJECT_PAGE_SIZE = 50;
const PROJECT_MAX_ITEMS = 1000;
/** 工数取得の期間（上限は未確認のため 31 日ごとに分ける） */
const MANHOUR_MAX_DAYS = 31;
const CACHE_TTL_MS = 5 * 60_000;

export interface ApiBackendOptions {
  /** 保存済みの自分の staffId（再発行 API の応答で得たもの） */
  knownStaffId?: () => Promise<number | undefined>;
}

/** クラウド勤怠Plus 公開 API を使うバックエンド */
export class ApiBackend implements KintaiBackend {
  readonly kind = 'api' as const;
  readonly capabilities: ReadonlySet<Capability> = new Set(ALL_CAPABILITIES);
  readonly #getClient: () => Promise<KintaiApiClient>;
  #profile: Promise<Profile> | undefined;
  #projects:
    | { value: Promise<{ projects: Project[]; truncated: boolean }>; at: number }
    | undefined;

  readonly #knownStaffId: () => Promise<number | undefined>;

  /** クライアントを直接、または必要になったときに作る関数で渡す（未ログインでもサーバーを起動できるように） */
  constructor(
    client: KintaiApiClient | (() => Promise<KintaiApiClient>),
    options: ApiBackendOptions = {},
  ) {
    this.#getClient = typeof client === 'function' ? client : async () => client;
    this.#knownStaffId = options.knownStaffId ?? (async () => undefined);
  }

  getMyProfile(): Promise<Profile> {
    this.#profile ??= this.#fetchProfile().catch((error: unknown) => {
      this.#profile = undefined; // 失敗は覚えない
      throw error;
    });
    return this.#profile;
  }

  async getStamps(range: DateRange, options: { staffId?: number } = {}): Promise<StampList> {
    const client = await this.#getClient();
    const path =
      options.staffId === undefined
        ? [COMPANY_ID, 'stamps']
        : [COMPANY_ID, 'stamps', options.staffId];
    const budget = { remaining: STAMP_MAX_REQUESTS };
    const stamps: Stamp[] = [];
    let truncated = false;

    const fetchRange = async (r: DateRange): Promise<void> => {
      if (budget.remaining-- <= 0) {
        truncated = true;
        return;
      }
      const res = await client.get(path, {
        start_date: formatStampQuery(startOfDay(r.from)),
        end_date: formatStampQuery(endOfDay(r.to)),
      });
      const page = parseStamps(res, options.staffId);
      const days = diffDays(r.from, r.to) + 1;
      if (page.length >= STAMP_MAX_RECORDS && days > 1) {
        // 上限に達した区間は半分にして取り直す
        for (const half of splitByDays(r.from, r.to, Math.ceil(days / 2))) await fetchRange(half);
        return;
      }
      if (page.length >= STAMP_MAX_RECORDS) truncated = true;
      stamps.push(...page);
    };

    for (const chunk of splitByMonths(range.from, range.to, STAMP_MAX_MONTHS, { maxChunks: 4 })) {
      await fetchRange(chunk);
    }
    stamps.sort((a, b) => a.stampedAt.getTime() - b.stampedAt.getTime());
    return { stamps, truncated };
  }

  async getWorkingRecords(
    range: DateRange,
    options: { staffIds?: number[] } = {},
  ): Promise<WorkingRecord[]> {
    const staffIds = options.staffIds ?? [(await this.getMyProfile()).staffId];
    const client = await this.#getClient();
    const records: WorkingRecord[] = [];
    const periods = splitByDays(range.from, range.to, WORKING_RECORD_MAX_DAYS, { maxChunks: 13 });
    for (const ids of chunk(staffIds, WORKING_RECORD_STAFF_PER_REQUEST)) {
      for (const period of periods) {
        const res = await client.get([COMPANY_ID, 'working_records'], {
          staff_ids: ids,
          start_date: formatCompactDate(period.from),
          end_date: formatCompactDate(period.to),
        });
        records.push(...parseWorkingRecords(res, ids.length === 1 ? ids[0] : undefined));
      }
    }
    return records.sort((a, b) =>
      a.date === b.date ? (a.staffId ?? 0) - (b.staffId ?? 0) : a.date < b.date ? -1 : 1,
    );
  }

  async getAlerts(): Promise<Alert[]> {
    const client = await this.#getClient();
    return parseAlerts(await client.get([COMPANY_ID, 'alerts']));
  }

  listProjects(): Promise<{ projects: Project[]; truncated: boolean }> {
    if (this.#projects && Date.now() - this.#projects.at < CACHE_TTL_MS)
      return this.#projects.value;
    const value = this.#fetchProjects().catch((error: unknown) => {
      this.#projects = undefined;
      throw error;
    });
    this.#projects = { value, at: Date.now() };
    return value;
  }

  async #fetchProjects(): Promise<{ projects: Project[]; truncated: boolean }> {
    const client = await this.#getClient();
    const result = await paginate(
      async (page) => {
        const res = await client.get([COMPANY_ID, 'projects'], { page });
        return { items: parseProjects(res), totalCount: readTotalCount(res) };
      },
      { pageSize: PROJECT_PAGE_SIZE, maxItems: PROJECT_MAX_ITEMS },
    );
    return { projects: result.items, truncated: result.truncated };
  }

  async listTasks(projectId: number): Promise<{ tasks: Task[]; truncated: boolean }> {
    const client = await this.#getClient();
    const result = await paginate(
      async (page) => {
        const res = await client.get([COMPANY_ID, projectId, 'tasks'], { page });
        return { items: parseTasks(res), totalCount: readTotalCount(res) };
      },
      { pageSize: PROJECT_PAGE_SIZE, maxItems: PROJECT_MAX_ITEMS },
    );
    return { tasks: result.items, truncated: result.truncated };
  }

  async getMyProjectIds(): Promise<number[]> {
    const { staffId } = await this.getMyProfile();
    const client = await this.#getClient();
    return parseStaffProjectIds(await client.get([COMPANY_ID, 'staff_projects', staffId]));
  }

  async getManhours(range: DateRange, options: { staffId?: number } = {}): Promise<ManhourDay[]> {
    const client = await this.#getClient();
    const path =
      options.staffId === undefined
        ? [COMPANY_ID, 'manhours']
        : [COMPANY_ID, 'manhours', options.staffId];
    const days: ManhourDay[] = [];
    for (const period of splitByDays(range.from, range.to, MANHOUR_MAX_DAYS, { maxChunks: 4 })) {
      const res = await client.get(path, {
        start_date: formatSlashDate(period.from),
        end_date: formatSlashDate(period.to),
      });
      days.push(...parseManhours(res, options.staffId));
    }
    return days;
  }

  async punch(input: PunchInput): Promise<{ stampedAt?: Date }> {
    const client = await this.#getClient();
    const res = await client.post([COMPANY_ID, 'stamps'], {
      type: STAMP_TYPE_CODES[input.type],
      stampedAt: formatSlashDateTime(input.at),
      timezone: JST_OFFSET,
      ...(input.telework ? { telework: 1 } : {}),
    });
    const [stamp] = parseStamps(res);
    return stamp ? { stampedAt: stamp.stampedAt } : {};
  }

  async saveManhours(input: SaveManhoursInput): Promise<void> {
    const { staffId } = await this.getMyProfile();
    const client = await this.#getClient();
    await client.post([COMPANY_ID, 'manhours'], {
      manhours: [
        {
          staff_id: staffId,
          dates: [
            {
              date: formatSlashDate(input.date),
              projects: input.projects.map((p) => ({
                project_id: p.projectId,
                daily_hour_items: p.items.map((i) => ({ task_id: i.taskId, minute: i.minutes })),
              })),
            },
          ],
        },
      ],
    });
  }

  async deleteManhours(input: {
    date: LocalDate;
    projectId: number;
    taskId?: number;
  }): Promise<void> {
    const { staffId } = await this.getMyProfile();
    const client = await this.#getClient();
    await client.delete([COMPANY_ID, 'manhours', staffId], {
      date: formatSlashDate(input.date),
      project_id: input.projectId,
      task_id: input.taskId,
    });
  }

  async #fetchProfile(): Promise<Profile> {
    const client = await this.#getClient();
    const staff = await fetchMyStaff(client, { staffId: await this.#knownStaffId() });
    const profile: Profile = { staffId: staff.staffId, role: permissionRole(staff.permissionType) };
    if (staff.name !== undefined) profile.name = staff.name;
    if (staff.staffNum !== undefined) profile.staffNum = staff.staffNum;
    if (staff.organizationName !== undefined) profile.organizationName = staff.organizationName;
    return profile;
  }
}
