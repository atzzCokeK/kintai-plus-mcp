import * as z from 'zod/v4';
import { STAMP_TYPE_LABEL, type Stamp } from '../api/stamps.ts';
import { computeDayStatus, DAY_STATE_LABEL } from '../domain/day-status.ts';
import { stripLocation } from '../privacy.ts';
import { formatIsoDateTime, todayInTokyo } from '../time/datetime.ts';
import { dateSchema, formatMinutes, resolveRange } from './common.ts';
import { defineTool } from './registry.ts';

export function formatStamp(
  stamp: Stamp,
  options: { includeLocation: boolean; attributes?: boolean },
) {
  const out: Record<string, unknown> = {
    stampedAt: formatIsoDateTime(stamp.stampedAt),
    type: stamp.type,
    typeLabel: STAMP_TYPE_LABEL[stamp.type],
  };
  if (stamp.staffId !== undefined) out.staffId = stamp.staffId;
  if (options.attributes !== false) {
    const attributes = stripLocation(stamp.attributes, options.includeLocation);
    if (Object.keys(attributes).length > 0) out.attributes = attributes;
  }
  return out;
}

const MAX_STAMP_DAYS = 366;

export const getStampsTool = defineTool({
  name: 'get_stamps',
  title: 'Get my punch history',
  description:
    'Get your own punch history (打刻履歴) for a period: clock in (出勤), clock out (退勤), direct in/out (直行/直帰), break start/end (休憩入/休憩戻). ' +
    `Defaults to today. Long periods are fetched in chunks automatically (max ${MAX_STAMP_DAYS} days). ` +
    'Location and IP address are omitted by default.',
  inputSchema: z.object({
    from: dateSchema.optional().describe('Start date (YYYY-MM-DD, Japan time). Defaults to today.'),
    to: dateSchema.optional().describe('End date, inclusive (YYYY-MM-DD). Defaults to `from`.'),
  }),
  capability: 'stamps.read',
  audience: 'everyone',
  kind: 'read',
  handler: async (input, ctx) => {
    const range = resolveRange(input, ctx.now(), { maxDays: MAX_STAMP_DAYS });
    const { stamps, truncated } = await ctx.backend.getStamps(range);
    const includeLocation = ctx.config.includeLocation;
    return {
      ...range,
      count: stamps.length,
      ...(truncated
        ? {
            truncated: true,
            note: 'Some punches could not be fetched because of the API limit (1000 per request). Use a shorter period.',
          }
        : {}),
      stamps: stamps.map((s) => formatStamp(s, { includeLocation })),
    };
  },
});

export const getTodayStatusTool = defineTool({
  name: 'get_today_status',
  title: "Get today's work status",
  description:
    "Get today's work status (今日の勤務状況) in Japan time: not_started (未出勤), working (勤務中), on_break (休憩中), or finished (退勤済み), " +
    "with time worked so far (excluding breaks), break time, and today's punches. Use this before punching.",
  inputSchema: z.object({}),
  capability: 'stamps.read',
  audience: 'everyone',
  kind: 'read',
  handler: async (_input, ctx) => {
    const now = ctx.now();
    const today = todayInTokyo(now);
    const { stamps } = await ctx.backend.getStamps({ from: today, to: today });
    const status = computeDayStatus(stamps, now);
    return {
      date: today,
      now: formatIsoDateTime(now),
      state: status.state,
      stateLabel: DAY_STATE_LABEL[status.state],
      workedMinutes: status.workedMinutes,
      workedHours: formatMinutes(status.workedMinutes),
      breakMinutes: status.breakMinutes,
      ...(status.firstClockInAt
        ? { firstClockInAt: formatIsoDateTime(status.firstClockInAt) }
        : {}),
      ...(status.lastClockOutAt
        ? { lastClockOutAt: formatIsoDateTime(status.lastClockOutAt) }
        : {}),
      stamps: stamps.map((s) => formatStamp(s, { includeLocation: false, attributes: false })),
    };
  },
});
