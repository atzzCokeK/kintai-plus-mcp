import * as z from 'zod/v4';
import { findAttendanceIssues, type IssueSeverity } from '../domain/attendance-issues.ts';
import { addDays, startOfMonth, todayInTokyo } from '../time/datetime.ts';
import { dateSchema, resolveRange } from './common.ts';
import { defineTool } from './registry.ts';

const MAX_DAYS = 93;

export const checkAttendanceIssuesTool = defineTool({
  name: 'check_attendance_issues',
  title: 'Check my attendance for issues',
  description:
    'Raw punch issues for yourself (打刻漏れチェック): missing clock-out/in, break left open, no punches on a workday, days over 12 hours, rest under 11 hours (勤務間インターバル), holiday work. ' +
    'Does NOT check Labor Standards Act break length (6h/45min, 8h/60min), man-hours, or the monthly overtime trajectory — close_out does, in one call. ' +
    'A missing punch is suppressed when the working record already has that time. ' +
    `Defaults: the 1st of this month through yesterday (on the 1st, the previous month), Japan time, YYYY-MM-DD, max ${MAX_DAYS} days. Today is excluded because the day may still be open. ` +
    'Overnight shifts are recognized. Leave is invisible, so "no punches" may be a day off. Fixing punches is 修正申請 in the web UI, not punch.',
  inputSchema: z.object({
    from: dateSchema.optional().describe('Start date (YYYY-MM-DD).'),
    to: dateSchema.optional().describe('End date, inclusive (YYYY-MM-DD). Defaults to yesterday.'),
  }),
  capability: 'working_records.read',
  audience: 'everyone',
  kind: 'read',
  handler: async (input, ctx) => {
    const yesterday = addDays(todayInTokyo(ctx.now()), -1);
    const range = resolveRange(input, ctx.now(), {
      from: startOfMonth(yesterday),
      to: () => yesterday,
      maxDays: MAX_DAYS,
    });
    // 打刻は範囲の前日から取り、初日の朝に終わる夜勤を打刻忘れにしない
    const [records, { stamps }] = await Promise.all([
      ctx.backend.getWorkingRecords(range),
      ctx.backend.getStamps({ from: addDays(range.from, -1), to: range.to }),
    ]);
    const issues = findAttendanceIssues({ range, records, stamps });
    const counts: Record<IssueSeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const issue of issues) counts[issue.severity]++;
    return {
      ...range,
      counts,
      issues,
      note: '打刻の修正は API ではできません。勤怠Plus の Web 画面から打刻修正の申請をしてください。 / Fix punches by submitting a correction request in the Kintai Plus web UI.',
    };
  },
});
