import * as z from 'zod/v4';
import { defineTool } from './registry.ts';

export const getAlertsTool = defineTool({
  name: 'get_alerts',
  title: 'Get my attendance alerts',
  description:
    'Get your own attendance alerts (アラート) from Kintai Plus, such as missing punches (打刻忘れ), suspected absence (欠勤疑い), ' +
    'late arrival (遅刻), early leave (早退), overtime threshold (残業時間閾値超え), 36 agreement (36協定), and missing man-hours (工数未入力). ' +
    'Optionally filter by month.',
  inputSchema: z.object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM')
      .optional()
      .describe('Only alerts for this month (YYYY-MM).'),
  }),
  capability: 'alerts.read',
  audience: 'everyone',
  kind: 'read',
  handler: async (input, ctx) => {
    const all = await ctx.backend.getAlerts();
    const alerts = input.month
      ? all.filter((a) => (a.month ?? a.date?.slice(0, 7)) === input.month)
      : all;
    return { ...(input.month ? { month: input.month } : {}), count: alerts.length, alerts };
  },
});
