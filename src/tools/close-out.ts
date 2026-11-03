import * as z from 'zod/v4';
import { buildCloseout, type CloseoutReport } from '../domain/close-out.ts';
import { addDays, endOfMonth, todayInTokyo } from '../time/datetime.ts';
import { assertMonth, dateSchema, monthSchema, resolveRange } from './common.ts';
import { defineTool } from './registry.ts';
import { ToolInputError } from './result.ts';

const MAX_THRESHOLD_HOURS = 200;

export const closeoutOutputSchema = z.object({
  scope: z.enum(['day', 'month']),
  timezone: z.literal('Asia/Tokyo'),
  today: z.string(),
  date: z.string().optional(),
  month: z.string(),
  from: z.string(),
  to: z.string(),
  ok: z.boolean(),
  readyToClose: z.boolean(),
  headline: z.string(),
  counts: z.object({
    error: z.number(),
    warning: z.number(),
    info: z.number(),
  }),
  items: z.array(
    z.object({
      priority: z.number(),
      severity: z.enum(['error', 'warning', 'info']),
      code: z.string(),
      date: z.string().optional(),
      title: z.string(),
      detail: z.string(),
      action: z.string(),
      tool: z.string().optional(),
      toolArgs: z.record(z.string(), z.string()).optional(),
    }),
  ),
  todayStatus: z
    .object({
      date: z.string(),
      state: z.enum(['not_started', 'working', 'on_break', 'finished']),
      stateLabel: z.string(),
      workedMinutes: z.number(),
      workedHours: z.string(),
      breakMinutes: z.number(),
    })
    .optional(),
  overtime: z.object({
    month: z.string(),
    asOf: z.string(),
    level: z.enum(['over', 'likely', 'watch', 'ok']),
    thresholdHours: z.number(),
    overtimeSoFarMinutes: z.number(),
    overtimeSoFarHours: z.string(),
    projectedOvertimeMinutes: z.number(),
    projectedOvertimeHours: z.string(),
    elapsedWorkDays: z.number(),
    remainingWorkDays: z.number(),
    breakTimeUnknown: z.boolean(),
  }),
  alerts: z.object({
    inScope: z.number(),
    listed: z.number(),
    alreadyCovered: z.number(),
  }),
  disclaimer: z.string(),
  note: z.string(),
});

export const closeOutTool = defineTool({
  name: 'close_out',
  title: 'Close out my day or month',
  description:
    'One read-only call for what you still need to do before closing a day or a month (1日の締め / 月末の締め). ' +
    'Returns a priority list: missing clock-out or break-end (退勤・休憩戻), a break shorter than the Labor Standards Act ' +
    '(over 6h worked needs 45 min, over 8h needs 60 min — a 3-minute lunch punch is not enough), ' +
    'man-hours missing or not matching time worked (工数), the monthly overtime estimate (法定時間外の目安), and alerts. ' +
    'Use this INSTEAD OF chaining get_today_status, check_attendance_issues, get_manhours, summarize_working_hours, and get_alerts. ' +
    'scope "day" (default) is one day, default today in Japan (Asia/Tokyo). scope "month" is that month through today, or the whole month if it has ended. ' +
    'Dates are YYYY-MM-DD. Months are YYYY-MM (01-12). ' +
    'When ok is true and items is empty, tell the user nothing else is required (headline says 対応は不要). ' +
    'Follow items in priority order. If action says 修正申請, do NOT call punch — the API cannot edit past stamps. ' +
    'This tool never punches or saves. Writes still need punch / save_manhours / delete_manhours after the user confirms.',
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
        'scope=day only. YYYY-MM-DD in Japan time. Defaults to today. Future dates are rejected. Do not pass this with scope=month.',
      ),
    month: monthSchema
      .optional()
      .describe(
        'scope=month only. YYYY-MM (month 01-12) in Japan time. Defaults to the current month. Future months are rejected. Do not pass this with scope=day.',
      ),
    thresholdHours: z
      .number()
      .int()
      .min(1)
      .max(MAX_THRESHOLD_HOURS)
      .optional()
      .describe(
        'Monthly statutory-overtime estimate that counts as a problem, in hours. Default 45 (the standard 36-agreement month). The figure is still only an estimate.',
      ),
  }),
  outputSchema: closeoutOutputSchema,
  capability: 'working_records.read',
  audience: 'everyone',
  kind: 'read',
  handler: async (input, ctx): Promise<CloseoutReport> => {
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
    // 範囲の翌朝（退勤・休憩戻）まで取る。今日より先は取らない。
    const nextMorning = addDays(reviewTo, 1);
    // biome-ignore lint/complexity/useMathMinMax: YYYY-MM-DD の文字列比較なので Math.min は使えない
    const stampTo = nextMorning < today ? nextMorning : today;
    const gaps: string[] = [];
    const [stampList, records, manhours, alerts] = await Promise.all([
      load(
        'get_stamps',
        ctx.backend.getStamps({ from: addDays(reviewFrom, -1), to: stampTo }),
        { stamps: [], truncated: false },
        gaps,
      ),
      load(
        'get_working_records',
        ctx.backend.getWorkingRecords({ from: monthStart, to: throughToday }),
        [],
        gaps,
      ),
      load('get_manhours', ctx.backend.getManhours({ from: reviewFrom, to: reviewTo }), [], gaps),
      load('get_alerts', ctx.backend.getAlerts(), [], gaps),
    ]);
    if (stampList.truncated) {
      gaps.push(
        'get_stamps hit the API limit, so some punches may be missing. Retry close_out with a shorter period if the list looks wrong.',
      );
    }
    return buildCloseout({
      scope,
      today,
      now,
      date,
      month,
      thresholdHours: input.thresholdHours ?? 45,
      records,
      stamps: stampList.stamps,
      manhours,
      alerts,
      ...(gaps.length > 0 ? { gaps } : {}),
      ...(ctx.config.readOnly ? { readOnly: true } : {}),
    });
  },
});

async function load<T>(name: string, task: Promise<T>, fallback: T, gaps: string[]): Promise<T> {
  try {
    return await task;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    gaps.push(
      `${name} failed (${message}). That part of the checklist was skipped. Retry close_out, or check 公開API利用可否 if this is a permission error.`,
    );
    return fallback;
  }
}
