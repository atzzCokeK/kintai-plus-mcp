import { endOfDay, formatStampQuery, startOfDay, todayInTokyo } from '../time/datetime.ts';
import type { KintaiApiClient } from './client.ts';
import { COMPANY_ID } from './endpoint.ts';
import { KintaiApiError } from './errors.ts';

/** 1=企業管理者、2=一般管理者、3=従業員 */
export type PermissionType = 1 | 2 | 3;
export type Role = 'company_admin' | 'admin' | 'employee';

export interface StaffSummary {
  staffId: number;
  name?: string;
  email?: string;
  staffNum?: string;
  organizationName?: string;
  permissionType?: number;
}

export function permissionRole(permissionType: number | undefined): Role {
  if (permissionType === 1) return 'company_admin';
  if (permissionType === 2) return 'admin';
  return 'employee';
}

export function isAdminRole(role: Role): boolean {
  return role !== 'employee';
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 最初に見つかったキーの値（camelCase と snake_case の両方を見る） */
function pick(obj: Rec, ...keys: string[]): unknown {
  for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * 従業員取得 API の 1 人分を読む。
 * 氏名は lastName / firstName。所属名は organization.Name（name も受ける）。
 * 配列や `{ staffs: [...] }` で包まれていれば先頭の人。
 */
export function parseStaff(value: unknown): StaffSummary | undefined {
  return parseStaffList(value)[0];
}

/** 従業員の一覧として読む（1 人分の応答なら 1 件の配列） */
export function parseStaffList(value: unknown): StaffSummary[] {
  if (Array.isArray(value)) return value.flatMap((v) => (isRec(v) ? toStaff(v) : []));
  if (!isRec(value)) return [];
  if (value.staffId === undefined && value.staff_id === undefined) {
    for (const key of ['staffs', 'staff']) if (key in value) return parseStaffList(value[key]);
    return [];
  }
  return toStaff(value);
}

function toStaff(raw: Rec): StaffSummary[] {
  const staffId = num(pick(raw, 'staffId', 'staff_id'));
  if (staffId === undefined) return [];

  const last = str(pick(raw, 'lastName', 'last_name', 'familyName', 'family_name'));
  const first = str(pick(raw, 'firstName', 'first_name', 'givenName', 'given_name'));
  const name =
    str(pick(raw, 'name', 'staffName', 'staff_name')) ??
    ([last, first].filter(Boolean).join(' ') || undefined);

  const org = pick(raw, 'organization');
  // ネストしたオブジェクトの名前は Name（organization.Name など）。name だけだと所属が落ちる。
  const organizationName = isRec(org)
    ? str(pick(org, 'Name', 'name', 'organizationName', 'organization_name'))
    : str(pick(raw, 'organizationName', 'organization_name'));

  const group = pick(raw, 'permissionGroup', 'permission_group');
  const permissionType = num(
    isRec(group)
      ? pick(group, 'permissionType', 'permission_type')
      : pick(raw, 'permissionType', 'permission_type'),
  );

  const out: StaffSummary = { staffId };
  if (name !== undefined) out.name = name;
  const email = str(pick(raw, 'email'));
  if (email !== undefined) out.email = email;
  const staffNum = str(pick(raw, 'staffNum', 'staff_num', 'staffNumber', 'staff_number'));
  if (staffNum !== undefined) out.staffNum = staffNum;
  if (organizationName !== undefined) out.organizationName = organizationName;
  if (permissionType !== undefined) out.permissionType = permissionType;
  return [out];
}

/**
 * 自分の従業員情報。自分の staffId がわかっていれば `/staffs/{staffId}` で取る。
 * 管理者の `GET /staffs`（page なし）は一覧を返す。1 人に決まらないときは
 * `GET /stamps` の `staff_id` で自分を決める（他人を自分と取り違えて権限を誤らないため）。
 */
export async function fetchMyStaff(
  client: KintaiApiClient,
  options: { staffId?: number | undefined; token?: string } = {},
): Promise<StaffSummary> {
  const tokenOpt = options.token ? { token: options.token } : undefined;
  if (options.staffId !== undefined) {
    const res = await client.get([COMPANY_ID, 'staffs', options.staffId], undefined, tokenOpt);
    const staff = parseStaffList(res).find((s) => s.staffId === options.staffId);
    if (!staff) {
      throw new KintaiApiError({
        kind: 'invalid_response',
        message: 'Staff response had no matching staff ID',
      });
    }
    return staff;
  }

  const list = parseStaffList(await client.get([COMPANY_ID, 'staffs'], undefined, tokenOpt));
  if (list.length === 1 && list[0]) return list[0];

  const ownerId = await fetchOwnerStaffId(client, tokenOpt);
  const fromList = list.find((s) => s.staffId === ownerId);
  if (fromList) return fromList;
  const byId = parseStaff(await client.get([COMPANY_ID, 'staffs', ownerId], undefined, tokenOpt));
  if (!byId) {
    throw new KintaiApiError({
      kind: 'invalid_response',
      message: 'Staff response had no matching staff ID',
    });
  }
  return byId;
}

/** 自分の staffId。打刻取得の応答に `staff_id` が入る（一覧からは自分を決められないとき用）。 */
async function fetchOwnerStaffId(
  client: KintaiApiClient,
  tokenOpt: { token: string } | undefined,
): Promise<number> {
  const today = todayInTokyo();
  const res = await client.get(
    [COMPANY_ID, 'stamps'],
    {
      start_date: formatStampQuery(startOfDay(today)),
      end_date: formatStampQuery(endOfDay(today)),
    },
    tokenOpt,
  );
  const id = isRec(res) ? num(res.staff_id ?? res.staffId) : undefined;
  if (id === undefined) {
    throw new KintaiApiError({
      kind: 'invalid_response',
      message: 'Could not determine your staff ID from the stamps response',
    });
  }
  return id;
}
