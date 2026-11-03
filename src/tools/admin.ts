import * as z from 'zod/v4';
import type { StaffSummary } from '../api/staff.ts';
import { computeDayStatus, DAY_STATE_LABEL, type DayStatus } from '../domain/day-status.ts';
import { type MinimalStaff, minimizeStaff } from '../privacy.ts';
import { addDays, diffDays, endOfDay, formatIsoDateTime, todayInTokyo } from '../time/datetime.ts';
import { dateSchema, resolveRange } from './common.ts';
import { defineTool, type ToolContext } from './registry.ts';
import { ToolInputError } from './result.ts';
import { formatStamp } from './stamps.ts';

export const staffIdsSchema = z
  .array(z.number().int().positive())
  .min(1)
  .max(500)
  .optional()
  .describe('Staff IDs (from list_staff). Defaults to all staff you manage.');

async function managedStaff(ctx: ToolContext): Promise<StaffSummary[]> {
  return (await ctx.backend.listStaff()).staff;
}

/** 名前の対応表。取れなければ空（ID だけで返す） */
export async function staffIndex(ctx: ToolContext): Promise<Map<number, MinimalStaff>> {
  try {
    return new Map((await managedStaff(ctx)).map((s) => [s.staffId, minimizeStaff(s)]));
  } catch (error) {
    ctx.logger.warn(
      `Could not load staff names (${error instanceof Error ? error.name : 'error'})`,
    );
    return new Map();
  }
}

function presentTeamState(
  status: DayStatus,
  stamps: readonly { type: string }[],
): { state: string; stateLabel: string } {
  if (status.unclosed === 'clock_out') {
    return { state: 'missing_clock_out', stateLabel: '退勤打刻なし' };
  }
  if (status.unclosed === 'break_end') {
    return { state: 'missing_break_end', stateLabel: '休憩戻なし' };
  }
  if (
    status.state === 'not_started' &&
    stamps.some(
      (stamp) =>
        stamp.type === 'clock_out' ||
        stamp.type === 'direct_out' ||
        stamp.type === 'break_start' ||
        stamp.type === 'break_end',
    )
  ) {
    return { state: 'missing_clock_in', stateLabel: '出勤打刻なし' };
  }
  return { state: status.state, stateLabel: DAY_STATE_LABEL[status.state] };
}

export async function resolveStaffIds(
  input: number[] | undefined,
  ctx: ToolContext,
): Promise<number[]> {
  if (input) {
    const unique = [...new Set(input)];
    try {
      const listed = await ctx.backend.listStaff();
      if (!listed.truncated) {
        const known = new Set(listed.staff.map((s) => s.staffId));
        const unknown = unique.filter((id) => !known.has(id));
        if (unknown.length > 0) {
          throw new ToolInputError(
            `Unknown staff ID(s): ${unknown.join(', ')}. They are not in the staff you manage. ` +
              'Use list_staff to get valid IDs. ' +
              'Kintai Plus reports an unknown ID as 「従業員IDは必ず入力してください」, which does not mean staffIds was omitted.',
          );
        }
      }
    } catch (error) {
      if (error instanceof ToolInputError) throw error;
      ctx.logger.warn(
        `Could not check staff IDs (${error instanceof Error ? error.name : 'error'})`,
      );
    }
    return unique;
  }
  const ids = (await managedStaff(ctx)).map((s) => s.staffId);
  if (ids.length > 500) {
    throw new ToolInputError(
      `You manage ${ids.length} staff; pass staffIds (up to 500) to narrow down.`,
    );
  }
  return ids;
}

export const listStaffTool = defineTool({
  name: 'list_staff',
  title: 'List staff I manage',
  description:
    'Admin only (hidden from employees). Staff you manage (従業員): staffId, name, staff number (社員番号), organization (所属). No email. ' +
    'Paging is automatic. query matches name, staff number, or organization (case-insensitive). ' +
    'staffId from here is what get_team_stamps, team_close_out, get_working_records, get_working_treatments, and find_overtime_risks expect. An ID outside this list is rejected before calling the API.',
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe('Case-insensitive text to match in name, staff number, or organization.'),
  }),
  capability: 'staff.read',
  audience: 'admin',
  kind: 'read',
  handler: async (input, ctx) => {
    const { staff, totalCount, truncated } = await ctx.backend.listStaff();
    const q = input.query?.trim().toLowerCase();
    const filtered = staff
      .map(minimizeStaff)
      .filter(
        (s) =>
          !q || [s.name, s.staffNum, s.organizationName].some((v) => v?.toLowerCase().includes(q)),
      );
    return {
      ...(totalCount !== undefined ? { totalCount } : {}),
      count: filtered.length,
      ...(truncated ? { truncated: true } : {}),
      staff: filtered,
    };
  },
});

export const getTeamStampsTool = defineTool({
  name: 'get_team_stamps',
  title: "Get my team's punches for a day",
  description:
    "Admin only. One day of punches for staff you manage, with each person's status " +
    '(not_started 未出勤 / working 勤務中 / on_break 休憩中 / finished 退勤済み) and minutes worked. ' +
    'date defaults to today (Japan time, YYYY-MM-DD). staffIds defaults to everyone you manage; unknown IDs are rejected when the staff list is complete. ' +
    'includeStamps defaults to false (status only). Requests are split into groups of 50. Location and IP are omitted. ' +
    'A past day that is still open is missing_clock_out (退勤打刻なし) or missing_break_end (休憩戻なし). Minutes are not extended to the end of that day. ' +
    'For a team day or month checklist call team_close_out once, not this tool once per day. Your own checklist is close_out.',
  inputSchema: z.object({
    date: dateSchema
      .optional()
      .describe(
        'One day (YYYY-MM-DD, Japan time). Defaults to today. This tool is a single day, not a range.',
      ),
    staffIds: staffIdsSchema,
    includeStamps: z
      .boolean()
      .optional()
      .describe('Include each punch. Default false (status only).'),
  }),
  capability: 'team_stamps.read',
  audience: 'admin',
  kind: 'read',
  handler: async (input, ctx) => {
    const now = ctx.now();
    const { from: date } = resolveRange({ from: input.date }, now, { maxDays: 1 });
    const ids = await resolveStaffIds(input.staffIds, ctx);
    const [{ stamps, truncated }, names] = await Promise.all([
      ctx.backend.getTeamStamps(date, ids),
      staffIndex(ctx),
    ]);
    // 今日は今まで。過去日は開いている区間を日末まで数えない（退勤打刻なし）。
    const today = todayInTokyo(now);
    const past = date < today;
    const asOf = past ? endOfDay(date) : now;
    const summary: Record<string, number> = {
      not_started: 0,
      working: 0,
      on_break: 0,
      finished: 0,
    };
    const people = ids.map((staffId) => {
      const own = stamps.filter((s) => s.staffId === staffId);
      const status = computeDayStatus(own, asOf, { countOpen: !past });
      const presented = presentTeamState(status, own);
      summary[presented.state] = (summary[presented.state] ?? 0) + 1;
      const name = names.get(staffId)?.name;
      return {
        staffId,
        ...(name ? { name } : {}),
        state: presented.state,
        stateLabel: presented.stateLabel,
        workedMinutes: status.workedMinutes,
        ...(status.firstClockInAt
          ? { firstClockInAt: formatIsoDateTime(status.firstClockInAt) }
          : {}),
        ...(status.lastClockOutAt
          ? { lastClockOutAt: formatIsoDateTime(status.lastClockOutAt) }
          : {}),
        ...(input.includeStamps
          ? {
              stamps: own.map((s) => {
                const { staffId: _id, ...rest } = formatStamp(s, {
                  includeLocation: ctx.config.includeLocation,
                });
                return rest;
              }),
            }
          : {}),
      };
    });
    return { date, summary, ...(truncated ? { truncated: true } : {}), staff: people };
  },
});

const MAX_STATUS_DAYS = 31;
const MAX_STATUS_COMBINATIONS = 5000;

export const getWorkingTreatmentsTool = defineTool({
  name: 'get_working_treatments',
  title: 'Get 勤務処理 labels',
  description:
    'Admin only. Company-configured 勤務処理 labels (public API: POST /working_statuses/search), such as absence (欠勤) or a business trip (出張). ' +
    "Not get_today_status: that tool is the signed-in person's live punch state for today only (未出勤 / 勤務中 / 休憩中 / 退勤済み). " +
    'These are labels the company defined, not a clock-in state. Show the label text as returned. Do not turn a label into a punch. ' +
    `Defaults to today only (Japan time, YYYY-MM-DD), all staff you manage, max ${MAX_STATUS_DAYS} days. ` +
    'Only days that have a label are returned. To see who has clocked in, use get_team_stamps.',
  inputSchema: z.object({
    from: dateSchema
      .optional()
      .describe(
        'Start date (YYYY-MM-DD, Japan time). Defaults to today, not the 1st of the month.',
      ),
    to: dateSchema
      .optional()
      .describe('End date, inclusive (YYYY-MM-DD, Japan time). Defaults to from (a single day).'),
    staffIds: staffIdsSchema,
  }),
  capability: 'working_statuses.read',
  audience: 'admin',
  kind: 'read',
  handler: async (input, ctx) => {
    const range = resolveRange(input, ctx.now(), { maxDays: MAX_STATUS_DAYS });
    const ids = await resolveStaffIds(input.staffIds, ctx);
    const days = diffDays(range.from, range.to) + 1;
    if (days * ids.length > MAX_STATUS_COMBINATIONS) {
      throw new ToolInputError(
        `${ids.length} staff × ${days} days is too many (max ${MAX_STATUS_COMBINATIONS}). Use a shorter period or fewer staff.`,
      );
    }
    const search = Array.from({ length: days }, (_, i) => addDays(range.from, i)).flatMap((date) =>
      ids.map((staffId) => ({ staffId, date })),
    );
    const [statuses, names] = await Promise.all([
      ctx.backend.getWorkingStatuses(search),
      staffIndex(ctx),
    ]);
    const withLabels = statuses
      .filter((s) => s.labels.length > 0)
      .map((s) => {
        const name = names.get(s.staffId)?.name;
        return { staffId: s.staffId, ...(name ? { name } : {}), date: s.date, labels: s.labels };
      });
    return { ...range, count: withLabels.length, statuses: withLabels };
  },
});

export const getProjectMembersTool = defineTool({
  name: 'get_project_members',
  title: 'Get project members',
  description:
    'Admin only. Members (プロジェクト従業員) and owners of one projectId, with names when list_staff succeeds. ' +
    'projectId comes from list_projects. This does not change membership.',
  inputSchema: z.object({
    projectId: z
      .number()
      .int()
      .positive()
      .describe('Project ID from list_projects. Not a staff ID.'),
  }),
  capability: 'project_members.read',
  audience: 'admin',
  kind: 'read',
  handler: async (input, ctx) => {
    const [{ staffIds, ownerStaffIds }, names] = await Promise.all([
      ctx.backend.getProjectMembers(input.projectId),
      staffIndex(ctx),
    ]);
    const ids = [...new Set([...staffIds, ...ownerStaffIds])];
    return {
      projectId: input.projectId,
      count: ids.length,
      members: ids.map((staffId) => ({
        ...(names.get(staffId) ?? { staffId }),
        owner: ownerStaffIds.includes(staffId),
      })),
    };
  },
});
