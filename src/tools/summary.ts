import * as z from 'zod/v4';
import {
  summarizeWorkingHours,
  UNKNOWN_BREAK_NOTE,
  type WorkingHoursSummary,
} from '../domain/summary.ts';
import { startOfMonth, todayInTokyo } from '../time/datetime.ts';
import { dateSchema, formatMinutes, resolveRange } from './common.ts';
import { defineTool } from './registry.ts';
import { MAX_RECORD_DAYS } from './working-records.ts';

export const OVERTIME_DISCLAIMER =
  '法定時間外は目安です（労働日・所定休日は 1 日 8 時間を超えた分、法定休日は全時間）。週 40 時間、変形労働時間制、フレックスタイム制は考慮していません。' +
  '正式な値は勤怠Plus の画面や給与計算で確認してください。 / The overtime figure is only an estimate; check Kintai Plus or payroll for official values.';

function withHours(s: WorkingHoursSummary) {
  return {
    ...s,
    totalWorkingHours: formatMinutes(s.totalWorkingMinutes),
    estimatedOvertimeHours: formatMinutes(s.estimatedOvertimeMinutes),
  };
}

export const summarizeWorkingHoursTool = defineTool({
  name: 'summarize_working_hours',
  title: 'Summarize my working hours',
  description:
    'Summarize your own working hours (勤務時間の集計) over a period: total actual working time (実働合計), work days (出勤日数), ' +
    'holiday work days (休日出勤日数), and an ESTIMATE of statutory overtime (法定時間外の目安), with a per-month breakdown. ' +
    `Defaults to the 1st of this month through today (max ${MAX_RECORD_DAYS} days). ` +
    'Always tell the user the overtime figure is an estimate.',
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
    const summary = summarizeWorkingHours(records);
    const byMonth = new Map<string, typeof records>();
    for (const record of records) {
      const month = record.date.slice(0, 7);
      byMonth.set(month, [...(byMonth.get(month) ?? []), record]);
    }
    return {
      ...range,
      ...withHours(summary),
      months: [...byMonth]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([month, rs]) => ({ month, ...withHours(summarizeWorkingHours(rs)) })),
      disclaimer: summary.breakTimeUnknown
        ? `${OVERTIME_DISCLAIMER} ${UNKNOWN_BREAK_NOTE}`
        : OVERTIME_DISCLAIMER,
    };
  },
});
