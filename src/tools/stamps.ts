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
    'Raw punch history (打刻履歴) for yourself: clock_in 出勤, clock_out 退勤, direct_in/out 直行/直帰, break_start/end 休憩入/休憩戻. ' +
    `Defaults: from=today, to=from, Japan time (YYYY-MM-DD). Max ${MAX_STAMP_DAYS} days, fetched in chunks. ` +
    "Use get_today_status for today's state in one glance, and close_out for what to fix. Use this when you need the timestamps. " +
    'Location and IP are omitted unless KINTAI_PLUS_INCLUDE_LOCATION=true.',
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
    'Live status for today only (Japan time, Asia/Tokyo): not_started 未出勤 / working 勤務中 / on_break 休憩中 / finished 退勤済み, ' +
    'minutes worked so far (breaks excluded), break minutes, and today\'s punches. No arguments; "today" is never a date you pass. ' +
    'Call this immediately before punch to see which type is legal. ' +
    'For the end-of-day checklist (short breaks, man-hours, overtime, alerts), use close_out scope=day instead of chaining tools.',
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
