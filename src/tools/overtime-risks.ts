import * as z from 'zod/v4';
import type { WorkingRecord } from '../api/working-records.ts';
import { assessOvertimeRisk, type RiskLevel } from '../domain/overtime-risk.ts';
import { minimizeStaff } from '../privacy.ts';
import { addDays, endOfMonth, todayInTokyo } from '../time/datetime.ts';
import { formatMinutes } from './common.ts';
import { defineTool } from './registry.ts';
import { ToolInputError } from './result.ts';

export const OVERTIME_RISK_DISCLAIMER =
  '法定時間外の目安（労働日・所定休日は 1 日 8 時間超、法定休日は全時間）を、ここまでの出勤日あたりのペースで残りの平日に延ばした予測です。' +
  '祝日・休暇の予定・週 40 時間・変形労働時間制・フレックスは考慮していません。36協定の上限（原則 月 45 時間）の判断は、勤怠Plus の画面や担当部署で確認してください。' +
  ' / This is a rough projection, not an official figure.';

const LEVEL_ORDER: RiskLevel[] = ['over', 'likely', 'watch', 'ok'];

export const findOvertimeRisksTool = defineTool({
  name: 'find_overtime_risks',
  title: 'Find overtime risks in my team',
  description:
    'Admin only. For staff you manage, estimate statutory overtime (法定時間外の目安) so far this month and project it to the month end ' +
    '(月末の着地予測), then list who is over or likely to exceed the threshold (default 45 hours, the standard monthly limit under a 36 agreement). ' +
    'Levels: over (already exceeded), likely (projected to exceed), watch (projected ≥ 80%). Always present results as estimates.',
  inputSchema: z.object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM')
      .optional()
      .describe('Month (YYYY-MM). Defaults to the current month.'),
    staffIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(500)
      .optional()
      .describe('Defaults to all staff you manage.'),
    thresholdHours: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Monthly overtime threshold in hours. Default 45.'),
    includeAll: z
      .boolean()
      .optional()
      .describe('Include staff with no risk (level ok). Default false.'),
  }),
  capability: 'working_records.read',
  audience: 'admin',
  kind: 'read',
  handler: async (input, ctx) => {
    const today = todayInTokyo(ctx.now());
    const month = input.month ?? today.slice(0, 7);
    const monthStart = `${month}-01`;
    if (monthStart > today) throw new ToolInputError(`${month} has not started yet.`);
    const monthEnd = endOfMonth(monthStart);
    // 今日の実績は途中なので、昨日までで数える
    const yesterday = addDays(today, -1);
    const asOf = yesterday < monthEnd ? yesterday : monthEnd;
    const thresholdHours = input.thresholdHours ?? 45;

    const { staff } = await ctx.backend.listStaff();
    const names = new Map(staff.map((s) => [s.staffId, minimizeStaff(s).name]));
    const ids = input.staffIds ?? staff.map((s) => s.staffId);
    const records: WorkingRecord[] =
      asOf >= monthStart
        ? await ctx.backend.getWorkingRecords({ from: monthStart, to: asOf }, { staffIds: ids })
        : [];

    const counts: Record<RiskLevel, number> = { over: 0, likely: 0, watch: 0, ok: 0 };
    const results = ids.map((staffId) => {
      const risk = assessOvertimeRisk({
        records: records.filter((r) => r.staffId === staffId),
        asOf: asOf >= monthStart ? asOf : addDays(monthStart, -1),
        monthEnd,
        thresholdMinutes: thresholdHours * 60,
      });
      counts[risk.level]++;
      const name = names.get(staffId);
      return {
        staffId,
        ...(name ? { name } : {}),
        level: risk.level,
        overtimeSoFarMinutes: risk.overtimeSoFarMinutes,
        overtimeSoFarHours: formatMinutes(risk.overtimeSoFarMinutes),
        projectedOvertimeMinutes: risk.projectedOvertimeMinutes,
        projectedOvertimeHours: formatMinutes(risk.projectedOvertimeMinutes),
        elapsedWorkDays: risk.elapsedWorkDays,
        remainingWorkDays: risk.remainingWorkDays,
      };
    });
    const shown = results
      .filter((r) => input.includeAll || r.level !== 'ok')
      .sort(
        (a, b) =>
          LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) ||
          b.projectedOvertimeMinutes - a.projectedOvertimeMinutes,
      );
    return {
      month,
      asOf,
      thresholdHours,
      counts,
      staff: shown,
      disclaimer: OVERTIME_RISK_DISCLAIMER,
    };
  },
});
