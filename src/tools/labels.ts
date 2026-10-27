import type { Role } from '../api/staff.ts';

export const ROLE_LABEL: Record<Role, string> = {
  company_admin: '企業管理者',
  admin: '一般管理者',
  employee: '従業員',
};
