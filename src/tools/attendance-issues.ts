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
    'Check your own punches and working records for issues (打刻漏れチェック): missing clock out/in (退勤・出勤の打刻忘れ), ' +
    'break not ended (休憩戻なし), no punches on a workday, days over 12 hours, rest interval under 11 hours (勤務間インターバル), and holiday work. ' +
    `Defaults to the 1st of this month through yesterday (on the 1st, the previous month). Max ${MAX_DAYS} days. ` +
    'Overnight shifts are recognized. Leave and requests are not visible via the API, so "no punches" may simply be a day off.',
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
