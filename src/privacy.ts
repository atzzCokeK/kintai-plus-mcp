import type { StaffSummary } from './api/staff.ts';

/**
 * AI に渡すデータを絞る（ADR 0006）。AI に渡したデータは AI の提供元にも送られるため、
 * 打刻の位置情報と IP は既定で除き、従業員情報も必要最小限にする。
 */
const LOCATION_KEYS = new Set([
  'latitude',
  'longitude',
  'lat',
  'lng',
  'lon',
  'ip',
  'ip_address',
  'ipAddress',
]);

export function stripLocation<T>(value: T, includeLocation: boolean): T {
  return includeLocation ? value : (strip(value) as T);
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!LOCATION_KEYS.has(key)) out[key] = strip(v);
  }
  return out;
}

export type MinimalStaff = Pick<StaffSummary, 'staffId' | 'name' | 'staffNum' | 'organizationName'>;

export function minimizeStaff(staff: StaffSummary): MinimalStaff {
  const out: MinimalStaff = { staffId: staff.staffId };
  if (staff.name !== undefined) out.name = staff.name;
  if (staff.staffNum !== undefined) out.staffNum = staff.staffNum;
  if (staff.organizationName !== undefined) out.organizationName = staff.organizationName;
  return out;
}
