import * as z from 'zod/v4';
import { DAY_CATEGORY_LABEL, type WorkingRecord } from '../api/working-records.ts';
import { readWorkingMinutes } from '../domain/worked-minutes.ts';
import { formatIsoDateTime, startOfMonth, todayInTokyo } from '../time/datetime.ts';
import { resolveStaffIds, staffIdsSchema } from './admin.ts';
import { dateSchema, formatMinutes, resolveRange } from './common.ts';
import { defineTool } from './registry.ts';

export const MAX_RECORD_DAYS = 366;

export function formatWorkingRecord(r: WorkingRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (r.staffId !== undefined) out.staffId = r.staffId;
  out.date = r.date;
  out.dayCategory = r.dayCategory;
  out.dayCategoryLabel = DAY_CATEGORY_LABEL[r.dayCategory];
  for (const key of ['startTime', 'endTime', 'clockInAt', 'clockOutAt'] as const) {
    const v = r[key];
    if (v) out[key] = formatIsoDateTime(v);
  }
  if (r.actualWorkingMinutes !== undefined) {
    out.actualWorkingMinutes = r.actualWorkingMinutes;
    out.actualWorkingHours = formatMinutes(r.actualWorkingMinutes);
  }
  const reading = readWorkingMinutes(r);
  if (reading.basis === 'statutory_minimum') {
    out.actualWorkingMinutesEstimated = true;
    out.breakTime = 'unknown';
    out.estimatedNetMinutes = reading.netMinutes;
    out.estimatedNetHours = formatMinutes(reading.netMinutes);
    out.assumedBreakMinutes = reading.assumedBreakMinutes ?? 0;
    out.estimateNote =
      '法定の最低休憩（6時間超で45分、8時間超で60分）を経過から引いた見積もりです。実際の休憩は不明です。';
  } else if (reading.basis === 'break_results') {
    out.actualWorkingMinutesEstimated = true;
    out.breakMinutes = reading.breakMinutes;
    out.netWorkingMinutes = reading.netMinutes;
    out.netWorkingHours = formatMinutes(reading.netMinutes);
  } else if (r.breakMinutes !== undefined) {
    out.breakMinutes = r.breakMinutes;
  }
  return out;
}

export const getWorkingRecordsTool = defineTool({
  name: 'get_working_records',
  title: 'Get my working records',
  description:
    'Daily working records (勤務実績): day category (労働日 / 所定休日 / 法定休日), start/end, punch times. ' +
    'staffIds is optional and defaults to yourself (omit it for the signed-in person; the response then has no staffId, same as before). ' +
    'Admins may pass staff they manage (from list_staff), up to 50 per request. ' +
    'When the API returns net minutes, actualWorkingMinutes is that value. When it does not, actualWorkingMinutes stays the elapsed start-to-end and estimatedNetMinutes subtracts known breaks or, if breaks are missing, the statutory minimum (over 6h → 45 min, over 8h → 60 min). That second figure is an estimate (estimateNote). ' +
    'Defaults: the 1st of this month through today (Japan time, YYYY-MM-DD). ' +
    `Split into 31-day requests (max ${MAX_RECORD_DAYS} days). No overtime field — summarize_working_hours for your totals, close_out for what you should fix, team_close_out for the team. Do not call this once per person to close a team.`,
  inputSchema: z.object({
    from: dateSchema
      .optional()
      .describe('Start date (YYYY-MM-DD). Defaults to the 1st of this month.'),
    to: dateSchema.optional().describe('End date, inclusive (YYYY-MM-DD). Defaults to today.'),
    staffIds: staffIdsSchema.describe(
      'Staff IDs to include. Omit for yourself only. Admins: IDs from list_staff. Unknown IDs are rejected when the staff list is complete.',
    ),
  }),
  capability: 'working_records.read',
  audience: 'everyone',
  kind: 'read',
  handler: async (input, ctx) => {
    const today = todayInTokyo(ctx.now());
    const range = resolveRange(input, ctx.now(), {
      from: startOfMonth(today),
      to: () => today,
      maxDays: MAX_RECORD_DAYS,
    });
    const staffIds =
      input.staffIds === undefined ? undefined : await resolveStaffIds(input.staffIds, ctx);
    const records = await ctx.backend.getWorkingRecords(
      range,
      staffIds === undefined ? {} : { staffIds },
    );
    return {
      ...range,
      count: records.length,
      records: records.map((r) => {
        const formatted = formatWorkingRecord(r);
        if (staffIds !== undefined) return formatted;
        const { staffId: _omit, ...rest } = formatted;
        return rest;
      }),
    };
  },
});
