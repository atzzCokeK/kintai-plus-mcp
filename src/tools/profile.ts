import * as z from 'zod/v4';
import { TIMEZONE, todayInTokyo } from '../time/datetime.ts';
import { ROLE_LABEL } from './labels.ts';
import { defineTool } from './registry.ts';

export const getMyProfileTool = defineTool({
  name: 'get_my_profile',
  title: 'Get my profile',
  description:
    'Who is signed in, and what is today in Japan? Returns staff ID, name, organization (所属), and role ' +
    '(company_admin 企業管理者 / admin 一般管理者 / employee 従業員), plus today (YYYY-MM-DD) and timezone Asia/Tokyo. ' +
    'Call this to learn the role before assuming admin tools exist. For what to do before leaving or at month-end, use close_out instead.',
  inputSchema: z.object({}),
  capability: 'profile',
  audience: 'everyone',
  kind: 'read',
  handler: async (_input, ctx) => {
    const profile = await ctx.backend.getMyProfile();
    return {
      ...profile,
      roleLabel: ROLE_LABEL[profile.role],
      today: todayInTokyo(ctx.now()),
      timezone: TIMEZONE,
    };
  },
});
