import * as z from 'zod/v4';
import { assertMonth, monthSchema } from './common.ts';
import { defineTool } from './registry.ts';

export const getAlertsTool = defineTool({
  name: 'get_alerts',
  title: 'Get my attendance alerts',
  description:
    'Raw attendance alerts (アラート) Kintai Plus already raised for you: 打刻忘れ, 欠勤疑い, 遅刻, 早退, 残業時間閾値超え, 36協定, 工数未入力, 休憩不足, and others. ' +
    'The API cannot filter; month (YYYY-MM, Japan time) is applied here. Omit month for every month the API returns. ' +
    'close_out already folds the relevant alerts into a prioritized list — call get_alerts only when you need the raw rows.',
  inputSchema: z.object({
    month: monthSchema
      .optional()
      .describe(
        'Only alerts for this month (YYYY-MM, month 01-12, Japan time). Omit for all months returned by the API.',
      ),
  }),
  capability: 'alerts.read',
  audience: 'everyone',
  kind: 'read',
  handler: async (input, ctx) => {
    if (input.month) assertMonth(input.month);
    const all = await ctx.backend.getAlerts();
    const alerts = input.month
      ? all.filter((a) => (a.month ?? a.date?.slice(0, 7)) === input.month)
      : all;
    return { ...(input.month ? { month: input.month } : {}), count: alerts.length, alerts };
  },
});
