import * as z from 'zod/v4';
import type { StaffSummary } from '../api/staff.ts';
import { computeDayStatus, DAY_STATE_LABEL, type DayState } from '../domain/day-status.ts';
import { type MinimalStaff, minimizeStaff } from '../privacy.ts';
import { addDays, diffDays, endOfDay, formatIsoDateTime, todayInTokyo } from '../time/datetime.ts';
import { dateSchema, resolveRange } from './common.ts';
import { defineTool, type ToolContext } from './registry.ts';
import { ToolInputError } from './result.ts';
import { formatStamp } from './stamps.ts';

const staffIdsSchema = z
  .array(z.number().int().positive())
  .min(1)
  .max(500)
  .optional()
  .describe('Staff IDs (from list_staff). Defaults to all staff you manage.');

async function managedStaff(ctx: ToolContext): Promise<StaffSummary[]> {
  return (await ctx.backend.listStaff()).staff;
}

/** 名前の対応表。取れなければ空（ID だけで返す） */
async function staffIndex(ctx: ToolContext): Promise<Map<number, MinimalStaff>> {
  try {
    return new Map((await managedStaff(ctx)).map((s) => [s.staffId, minimizeStaff(s)]));
  } catch (error) {
    ctx.logger.warn(
      `Could not load staff names (${error instanceof Error ? error.name : 'error'})`,
    );
    return new Map();
  }
}

async function resolveStaffIds(input: number[] | undefined, ctx: ToolContext): Promise<number[]> {
  if (input) return [...new Set(input)];
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
    'Admin only. List the staff (従業員) you manage, with staff ID, name, staff number (社員番号), and organization (所属). ' +
    'Paging is handled automatically. Optionally filter by text. Email and other personal details are not returned.',
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
    "Admin only. Get the punches (打刻) of staff you manage for one day, with each person's status " +
    '(not_started 未出勤 / working 勤務中 / on_break 休憩中 / finished 退勤済み) and time worked. ' +
    'Defaults to today and all staff you manage. Requests are split into groups of 50 automatically. Location and IP are omitted.',
  inputSchema: z.object({
    date: dateSchema.optional().describe('Date (YYYY-MM-DD). Defaults to today.'),
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
    // 過去の日はその日の終わりまで、今日は今までで数える
    const asOf = date < todayInTokyo(now) ? endOfDay(date) : now;
    const summary: Record<DayState, number> = {
      not_started: 0,
      working: 0,
      on_break: 0,
      finished: 0,
    };
    const people = ids.map((staffId) => {
      const own = stamps.filter((s) => s.staffId === staffId);
      const status = computeDayStatus(own, asOf);
      summary[status.state]++;
      const name = names.get(staffId)?.name;
      return {
        staffId,
        ...(name ? { name } : {}),
        state: status.state,
        stateLabel: DAY_STATE_LABEL[status.state],
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

export const getWorkingStatusesTool = defineTool({
  name: 'get_working_statuses',
  title: 'Get working statuses (勤務処理)',
  description:
    'Admin only. Get working statuses (勤務処理) such as absence (欠勤) or business trip (出張) — labels are configured per company — ' +
    `for staff you manage over a period (max ${MAX_STATUS_DAYS} days). Defaults to today and all staff you manage. ` +
    'Only days that have a status are returned.',
  inputSchema: z.object({
    from: dateSchema.optional().describe('Start date (YYYY-MM-DD). Defaults to today.'),
    to: dateSchema.optional().describe('End date, inclusive (YYYY-MM-DD). Defaults to `from`.'),
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
    'Admin only. List the members (プロジェクト従業員) and owners of a project, with names where available.',
  inputSchema: z.object({ projectId: z.number().int().positive() }),
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
