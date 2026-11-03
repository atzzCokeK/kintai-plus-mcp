import * as z from 'zod/v4';
import type { Stamp } from '../api/stamps.ts';
import type { WorkingRecord } from '../api/working-records.ts';
import { buildTeamCloseout, type TeamCloseoutReport } from '../domain/team-close-out.ts';
import { addDays, endOfMonth, todayInTokyo } from '../time/datetime.ts';
import { resolveStaffIds, staffIdsSchema, staffIndex } from './admin.ts';
import { assertMonth, dateSchema, monthSchema, resolveRange } from './common.ts';
import { defineTool, type ToolContext } from './registry.ts';
import { ToolInputError } from './result.ts';

const MAX_THRESHOLD_HOURS = 200;

const dayIssueSchema = z.object({
  date: z.string(),
  code: z.string(),
  severity: z.enum(['error', 'warning', 'info']),
  title: z.string(),
  detail: z.string(),
});

const memberSchema = z.object({
  staffId: z.number(),
  name: z.string().optional(),
  staffNum: z.string().optional(),
  days: z.array(dayIssueSchema),
  overtime: z
    .object({
      level: z.enum(['over', 'likely', 'watch']),
      overtimeSoFarMinutes: z.number(),
      overtimeSoFarHours: z.string(),
      projectedOvertimeMinutes: z.number(),
      projectedOvertimeHours: z.string(),
      limitHours: z.number(),
      watchHours: z.number(),
      estimated: z.boolean(),
      detail: z.string(),
    })
    .optional(),
});

export const teamCloseoutOutputSchema = z.object({
  scope: z.enum(['day', 'month']),
  timezone: z.literal('Asia/Tokyo'),
  today: z.string(),
  date: z.string().optional(),
  month: z.string(),
  from: z.string(),
  to: z.string(),
  staffCount: z.number(),
  needsActionCount: z.number(),
  noIssueCount: z.number(),
  ok: z.boolean(),
  headline: z.string(),
  members: z.array(memberSchema),
  noActivity: z.array(
    z.object({
      staffId: z.number(),
      name: z.string().optional(),
      staffNum: z.string().optional(),
      note: z.string(),
    }),
  ),
  unsupported: z.array(z.string()),
  overtimeThresholds: z.object({
    limitHours: z.number(),
    watchHours: z.number(),
  }),
  breakTimeUnknown: z.boolean(),
  disclaimer: z.string(),
  note: z.string(),
  gaps: z.array(z.string()).optional(),
});

export const teamCloseOutTool = defineTool({
  name: 'team_close_out',
  title: 'Close out my team for a day or month',
  description:
    'Admin only (hidden from employees). One read-only call for what managed staff still need before closing a day or a month (チームの締め). ' +
    'Judges from working records first (勤務実績) and uses punches only to see break length and punch shape. A day the record already has start and end is not a missing punch, even if the raw punches look open. ' +
    'Each person who needs action is listed with staffId, name, and staff number (社員番号) — same names are distinguished by those ids — and the days plus reasons: missing clock-out or break-end (退勤・休憩戻), duplicate clock-in (出勤の重複), clock-out or break with no clock-in (出勤無し), break shorter than the Labor Standards Act (over 6h needs 45 min, over 8h needs 60 min), rest interval under 11 hours (勤務間インターバル), and the monthly overtime estimate against 36h (80% of the threshold) and 45h (the default 36-agreement month). ' +
    'People with nothing to fix are a count only (noIssueCount). People with zero records and zero punches in the period are noActivity, separate from the count (possible leave or resignation). If nothing needs action and noActivity is empty, headline says 対応は不要. ' +
    'scope "day" (default) is one day, default today in Japan. scope "month" is that month through today, or the whole month if it has ended. Dates are YYYY-MM-DD. Months are YYYY-MM (01-12). staffIds defaults to everyone you manage. Requests are split into 50 people and 31 days. ' +
    'Today still in progress is not a missing clock-out. Alerts and unentered man-hours are NOT included (the alerts API is the caller only; say so from unsupported). Do not call get_team_stamps per day or get_working_records per person instead of this. Do not call punch for a teammate — punch records the caller. Past fixes are 修正申請 in the web UI.',
  inputSchema: z.object({
    scope: z
      .enum(['day', 'month'])
      .optional()
      .describe(
        'day (default): one day. month: the whole month up to today, or through month-end if that month is already over.',
      ),
    date: dateSchema
      .optional()
      .describe(
        'scope=day only. YYYY-MM-DD in Japan time. Defaults to today. Future dates are rejected.',
      ),
    month: monthSchema
      .optional()
      .describe(
        'scope=month only. YYYY-MM (month 01-12) in Japan time. Defaults to the current month. Future months are rejected.',
      ),
    staffIds: staffIdsSchema,
    thresholdHours: z
      .number()
      .int()
      .min(1)
      .max(MAX_THRESHOLD_HOURS)
      .optional()
      .describe(
        'Monthly statutory-overtime estimate that counts as over, in hours. Default 45. The watch line is 80% of this (36 when the threshold is 45). The figure is still only an estimate.',
      ),
  }),
  outputSchema: teamCloseoutOutputSchema,
  capability: 'working_records.read',
  audience: 'admin',
  kind: 'read',
  handler: async (input, ctx): Promise<TeamCloseoutReport> => {
    const now = ctx.now();
    const today = todayInTokyo(now);
    const scope = input.scope ?? 'day';
    if (scope === 'day' && input.month !== undefined) {
      throw new ToolInputError(
        'month is only valid with scope "month". For one day, pass date (YYYY-MM-DD) or omit it to use today in Japan.',
      );
    }
    if (scope === 'month' && input.date !== undefined) {
      throw new ToolInputError(
        'date is only valid with scope "day". For a month, pass month (YYYY-MM) or omit it to use the current month in Japan.',
      );
    }
    if (input.month) assertMonth(input.month);

    let date = today;
    let month = today.slice(0, 7);
    if (scope === 'day') {
      if (input.date) date = resolveRange({ from: input.date }, now, { maxDays: 1 }).from;
      if (date > today) {
        throw new ToolInputError(
          `${date} is in the future. Today in Japan (Asia/Tokyo) is ${today}.`,
        );
      }
      month = date.slice(0, 7);
    } else {
      month = input.month ?? month;
      if (`${month}-01` > today) {
        throw new ToolInputError(
          `${month} has not started yet. Today in Japan (Asia/Tokyo) is ${today}.`,
        );
      }
    }

    const monthStart = `${month}-01`;
    const monthEnd = endOfMonth(monthStart);
    // biome-ignore lint/complexity/useMathMinMax: YYYY-MM-DD の文字列比較なので Math.min は使えない
    const throughToday = monthEnd < today ? monthEnd : today;
    const reviewFrom = scope === 'day' ? date : monthStart;
    const reviewTo = scope === 'day' ? date : throughToday;
    const stampFrom = addDays(reviewFrom, -1);
    const nextMorning = addDays(reviewTo, 1);
    // biome-ignore lint/complexity/useMathMinMax: YYYY-MM-DD の文字列比較なので Math.min は使えない
    const stampTo = nextMorning < today ? nextMorning : today;

    const ids = await resolveStaffIds(input.staffIds, ctx);
    const names = await staffIndex(ctx);
    const members = ids.map((staffId) => {
      const staff = names.get(staffId);
      return {
        staffId,
        ...(staff?.name !== undefined ? { name: staff.name } : {}),
        ...(staff?.staffNum !== undefined ? { staffNum: staff.staffNum } : {}),
      };
    });

    const gaps: string[] = [];
    const records = await load(
      'get_working_records',
      ctx.backend.getWorkingRecords({ from: monthStart, to: throughToday }, { staffIds: ids }),
      [] as WorkingRecord[],
      gaps,
    );
    const stampList = await load(
      'get_team_stamps',
      collectTeamStamps(ctx, ids, stampFrom, stampTo),
      { stamps: [] as Stamp[], truncated: false },
      gaps,
    );
    if (stampList.value.truncated) {
      gaps.push(
        'get_team_stamps hit the API limit, so some punches may be missing. Retry team_close_out with fewer staff if the list looks wrong.',
      );
    }
    return buildTeamCloseout({
      scope,
      today,
      date,
      month,
      thresholdHours: input.thresholdHours ?? 45,
      members,
      records: records.value,
      stamps: stampList.value.stamps,
      recordsOk: records.ok,
      stampsOk: stampList.ok,
      ...(gaps.length > 0 ? { gaps } : {}),
    });
  },
});

async function collectTeamStamps(
  ctx: ToolContext,
  ids: number[],
  from: string,
  to: string,
): Promise<{ stamps: Stamp[]; truncated: boolean }> {
  if (ids.length === 0 || from > to) return { stamps: [], truncated: false };
  const stamps: Stamp[] = [];
  let truncated = false;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const page = await ctx.backend.getTeamStamps(date, ids);
    stamps.push(...page.stamps);
    if (page.truncated) truncated = true;
  }
  return { stamps, truncated };
}

async function load<T>(
  name: string,
  task: Promise<T>,
  fallback: T,
  gaps: string[],
): Promise<{ value: T; ok: boolean }> {
  try {
    return { value: await task, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    gaps.push(
      `${name} failed (${message}). That part of the checklist was skipped. Retry team_close_out, or check 公開API利用可否 if this is a permission error.`,
    );
    return { value: fallback, ok: false };
  }
}
