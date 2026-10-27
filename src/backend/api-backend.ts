import type { KintaiApiClient } from '../api/client.ts';
import { COMPANY_ID } from '../api/endpoint.ts';
import { chunk, type DateRange, splitByDays, splitByMonths } from '../api/paging.ts';
import { fetchMyStaff, permissionRole } from '../api/staff.ts';
import { parseStamps, type Stamp } from '../api/stamps.ts';
import { parseWorkingRecords, type WorkingRecord } from '../api/working-records.ts';
import {
  diffDays,
  endOfDay,
  formatCompactDate,
  formatStampQuery,
  startOfDay,
} from '../time/datetime.ts';
import {
  ALL_CAPABILITIES,
  type Capability,
  type KintaiBackend,
  type Profile,
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

/** クラウド勤怠Plus 公開 API を使うバックエンド */
export class ApiBackend implements KintaiBackend {
  readonly kind = 'api' as const;
  readonly capabilities: ReadonlySet<Capability> = new Set(ALL_CAPABILITIES);
  readonly #getClient: () => Promise<KintaiApiClient>;
  #profile: Promise<Profile> | undefined;

  /** クライアントを直接、または必要になったときに作る関数で渡す（未ログインでもサーバーを起動できるように） */
  constructor(client: KintaiApiClient | (() => Promise<KintaiApiClient>)) {
    this.#getClient = typeof client === 'function' ? client : async () => client;
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

  async #fetchProfile(): Promise<Profile> {
    const staff = await fetchMyStaff(await this.#getClient());
    const profile: Profile = { staffId: staff.staffId, role: permissionRole(staff.permissionType) };
    if (staff.name !== undefined) profile.name = staff.name;
    if (staff.staffNum !== undefined) profile.staffNum = staff.staffNum;
    if (staff.organizationName !== undefined) profile.organizationName = staff.organizationName;
    return profile;
  }
}
