import * as z from 'zod/v4';
import { DAY_CATEGORY_LABEL, type WorkingRecord } from '../api/working-records.ts';
import { formatIsoDateTime, startOfMonth, todayInTokyo } from '../time/datetime.ts';
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
  if (r.breakMinutes !== undefined) out.breakMinutes = r.breakMinutes;
  return out;
}

export const getWorkingRecordsTool = defineTool({
  name: 'get_working_records',
  title: 'Get my working records',
  description:
    'Get your own daily working records (勤務実績): day category (労働日 / 所定休日 / 法定休日), start/end time, punch times, ' +
    'actual working minutes (実働時間, unrounded) and break minutes. Defaults to the 1st of this month through today. ' +
    `Long periods are split into 31-day requests automatically (max ${MAX_RECORD_DAYS} days). ` +
    'There is no overtime field; use summarize_working_hours for totals and an overtime estimate.',
  inputSchema: z.object({
    from: dateSchema
      .optional()
      .describe('Start date (YYYY-MM-DD). Defaults to the 1st of this month.'),
    to: dateSchema.optional().describe('End date, inclusive (YYYY-MM-DD). Defaults to today.'),
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
    const records = await ctx.backend.getWorkingRecords(range);
    return {
      ...range,
      count: records.length,
      records: records.map((r) => {
        const { staffId: _omit, ...rest } = formatWorkingRecord(r);
        return rest;
      }),
    };
  },
});
