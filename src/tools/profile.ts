import * as z from 'zod/v4';
import { TIMEZONE, todayInTokyo } from '../time/datetime.ts';
import { ROLE_LABEL } from './labels.ts';
import { defineTool } from './registry.ts';

export const getMyProfileTool = defineTool({
  name: 'get_my_profile',
  title: 'Get my profile',
  description:
    "Get the signed-in employee's own profile (従業員情報): staff ID, name, organization (所属), and permission role " +
    "(company_admin 企業管理者 / admin 一般管理者 / employee 従業員). Also returns today's date in Japan time.",
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
