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
 * 従業員取得 API の 1 人分を読む。応答の形が一次情報で確認できていないため、
 * camelCase / snake_case、配列や `{ staffs: [...] }` で包まれた形も受け付ける。
 */
export function parseStaff(value: unknown): StaffSummary | undefined {
  const raw = unwrap(value);
  if (!raw) return undefined;
  const staffId = num(pick(raw, 'staffId', 'staff_id'));
  if (staffId === undefined) return undefined;

  const last = str(pick(raw, 'lastName', 'last_name', 'familyName', 'family_name'));
  const first = str(pick(raw, 'firstName', 'first_name', 'givenName', 'given_name'));
  const name =
    str(pick(raw, 'name', 'staffName', 'staff_name')) ??
    ([last, first].filter(Boolean).join(' ') || undefined);

  const org = pick(raw, 'organization');
  const organizationName = isRec(org)
    ? str(pick(org, 'name', 'organizationName', 'organization_name'))
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
  return out;
}

function unwrap(value: unknown): Rec | undefined {
  if (Array.isArray(value)) return unwrap(value[0]);
  if (!isRec(value)) return undefined;
  for (const key of ['staffs', 'staff']) {
    if (key in value && value.staffId === undefined && value.staff_id === undefined) {
      return unwrap(value[key]);
    }
  }
  return value;
}

/** 自分の従業員情報（`GET /{companyId}/staffs`） */
export async function fetchMyStaff(client: KintaiApiClient, token?: string): Promise<StaffSummary> {
  const res = await client.get([COMPANY_ID, 'staffs'], undefined, token ? { token } : undefined);
  const staff = parseStaff(res);
  if (!staff) {
    throw new KintaiApiError({
      kind: 'invalid_response',
      message: 'Staff response had no staff ID',
    });
  }
  return staff;
}
