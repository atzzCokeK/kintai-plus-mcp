import * as z from 'zod/v4';
import type { ManhourDay } from '../api/manhours.ts';
import type { Project } from '../api/projects.ts';
import type { KintaiBackend } from '../backend/types.ts';
import { endOfMonth, startOfMonth, todayInTokyo } from '../time/datetime.ts';
import { dateSchema, formatMinutes, resolveRange } from './common.ts';
import { defineTool, type ToolContext } from './registry.ts';

const idSchema = z.number().int().positive();

function isActiveOn(project: Project, date: string): boolean {
  return (
    (!project.startDate || project.startDate <= date) &&
    (!project.endDate || date <= project.endDate)
  );
}

export const listProjectsTool = defineTool({
  name: 'list_projects',
  title: 'List projects',
  description:
    'Search the company project list (プロジェクト) used for man-hours (工数). ' +
    'Prefer get_my_projects when logging your own time; use this to search by name or code, or to see projects you might not belong to. ' +
    'activeOn is YYYY-MM-DD (Japan time) and keeps projects whose period includes that date. projectId goes to list_tasks and save_manhours.',
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe('Case-insensitive text to match in name, short name, or code.'),
    activeOn: dateSchema
      .optional()
      .describe('Only projects whose period includes this date (YYYY-MM-DD).'),
  }),
  capability: 'projects.read',
  audience: 'everyone',
  kind: 'read',
  handler: async (input, ctx) => {
    const { projects, truncated } = await ctx.backend.listProjects();
    const q = input.query?.trim().toLowerCase();
    const filtered = projects.filter(
      (p) =>
        (!q || [p.name, p.shortName, p.code].some((v) => v?.toLowerCase().includes(q))) &&
        (!input.activeOn || isActiveOn(p, input.activeOn)),
    );
    return {
      count: filtered.length,
      ...(truncated ? { truncated: true } : {}),
      projects: filtered,
    };
  },
});

export const listTasksTool = defineTool({
  name: 'list_tasks',
  title: 'List tasks of a project',
  description:
    'Tasks (タスク) of one projectId from get_my_projects or list_projects. Call this before save_manhours so taskId is real. ' +
    'Finished tasks (終了) are hidden unless includeFinished is true. estimatedMinutes is minutes (estimatedHours is the same value as H:MM).',
  inputSchema: z.object({
    projectId: idSchema.describe('Project ID from list_projects or get_my_projects.'),
    includeFinished: z.boolean().optional().describe('Include finished tasks. Default false.'),
  }),
  capability: 'projects.read',
  audience: 'everyone',
  kind: 'read',
  handler: async (input, ctx) => {
    const { tasks, truncated } = await ctx.backend.listTasks(input.projectId);
    const filtered = input.includeFinished ? tasks : tasks.filter((t) => !t.finished);
    return {
      projectId: input.projectId,
      count: filtered.length,
      ...(truncated ? { truncated: true } : {}),
      tasks: filtered.map((t) => ({
        ...t,
        ...(t.estimatedMinutes !== undefined
          ? { estimatedHours: formatMinutes(t.estimatedMinutes) }
          : {}),
      })),
    };
  },
});

export const getMyProjectsTool = defineTool({
  name: 'get_my_projects',
  title: 'Get my projects',
  description:
    'Projects you belong to (参加プロジェクト), with names. Prefer this over list_projects when entering your own man-hours. ' +
    'If a name is missing, the project list could not be loaded; the projectId is still valid for list_tasks and save_manhours.',
  inputSchema: z.object({}),
  capability: 'projects.read',
  audience: 'everyone',
  kind: 'read',
  handler: async (_input, ctx) => {
    const ids = await ctx.backend.getMyProjectIds();
    const byId = await projectIndex(ctx.backend, ctx);
    const projects = ids.map((id) => byId?.get(id) ?? { projectId: id });
    return { count: projects.length, projects };
  },
});

async function projectIndex(backend: KintaiBackend, ctx: ToolContext) {
  try {
    const { projects } = await backend.listProjects();
    return new Map(projects.map((p) => [p.projectId, p]));
  } catch (error) {
    ctx.logger.warn(
      `Could not load project names (${error instanceof Error ? error.name : 'error'})`,
    );
    return undefined;
  }
}

/** 工数の日ごとのデータに、プロジェクト名・タスク名を補う。取れなければ ID だけにする */
export async function withNames(days: ManhourDay[], ctx: ToolContext) {
  const projects = days.length > 0 ? await projectIndex(ctx.backend, ctx) : undefined;
  const taskNames = new Map<number, Map<number, string> | undefined>();
  const tasksOf = async (projectId: number) => {
    if (!taskNames.has(projectId)) {
      try {
        const { tasks } = await ctx.backend.listTasks(projectId);
        taskNames.set(projectId, new Map(tasks.map((t) => [t.taskId, t.name])));
      } catch {
        taskNames.set(projectId, undefined);
      }
    }
    return taskNames.get(projectId);
  };

  const out = [];
  for (const day of days) {
    const projectsOut = [];
    for (const p of day.projects) {
      const names = projects ? await tasksOf(p.projectId) : undefined;
      const projectName = projects?.get(p.projectId)?.name;
      projectsOut.push({
        projectId: p.projectId,
        ...(projectName ? { projectName } : {}),
        totalMinutes: p.totalMinutes,
        items: p.items.map((i) => {
          const taskName = names?.get(i.taskId);
          return { taskId: i.taskId, ...(taskName ? { taskName } : {}), minutes: i.minutes };
        }),
      });
    }
    out.push({ ...day, projects: projectsOut });
  }
  return out;
}

const MAX_MANHOUR_DAYS = 93;

export const getManhoursTool = defineTool({
  name: 'get_manhours',
  title: 'Get my man-hours',
  description:
    'Your man-hours (工数) per day, project, and task, in minutes, with names when the directory can be loaded. ' +
    `Defaults: from=the 1st of this month, to=the end of that month (Japan time, YYYY-MM-DD), max ${MAX_MANHOUR_DAYS} days. ` +
    'closed (締め) or fixed (確定) days cannot be changed with save_manhours or delete_manhours. ' +
    'close_out says which days are missing or off; call this to see the entries before changing them.',
  inputSchema: z.object({
    from: dateSchema
      .optional()
      .describe('Start date (YYYY-MM-DD). Defaults to the 1st of this month.'),
    to: dateSchema
      .optional()
      .describe('End date, inclusive (YYYY-MM-DD). Defaults to the end of the month of `from`.'),
  }),
  capability: 'manhours.read',
  audience: 'everyone',
  kind: 'read',
  handler: async (input, ctx) => {
    const range = resolveRange(input, ctx.now(), {
      from: startOfMonth(todayInTokyo(ctx.now())),
      to: (from) => endOfMonth(from),
      maxDays: MAX_MANHOUR_DAYS,
    });
    const days = await ctx.backend.getManhours(range);
    const totalMinutes = days.reduce((sum, d) => sum + d.totalMinutes, 0);
    return {
      ...range,
      totalMinutes,
      totalHours: formatMinutes(totalMinutes),
      days: await withNames(days, ctx),
    };
  },
});
