import * as z from 'zod/v4';
import type { ManhourDay, ManhourItem } from '../api/manhours.ts';
import type { Task } from '../api/projects.ts';
import { isValidLocalDate, type LocalDate } from '../time/datetime.ts';
import { dateSchema, formatMinutes } from './common.ts';
import { defineTool, type ToolContext } from './registry.ts';
import { ToolInputError, ToolRefusedError } from './result.ts';

const DAY_MINUTES = 24 * 60;

async function loadDay(date: LocalDate, ctx: ToolContext): Promise<ManhourDay | undefined> {
  if (!isValidLocalDate(date)) throw new ToolInputError(`Invalid date: ${date} (use YYYY-MM-DD)`);
  const days = await ctx.backend.getManhours({ from: date, to: date });
  const day = days.find((d) => d.date === date);
  if (day && (day.closed || day.fixed)) {
    throw new ToolRefusedError(
      `Man-hours for ${date} are already ${day.fixed ? 'fixed (確定)' : 'closed (締め)'} and cannot be changed.`,
      'Ask the user to have it reopened in the Kintai Plus web UI if a change is needed.',
    );
  }
  return day;
}

export const saveManhoursTool = defineTool({
  name: 'save_manhours',
  title: 'Save my man-hours',
  description:
    'Create or update your own man-hours (工数) for one day: minutes per project task. ' +
    'Only the listed tasks are overwritten; other tasks on that day are kept. To remove an entry, use delete_manhours. ' +
    'Use list_projects / get_my_projects and list_tasks to find IDs. Days that are closed (締め) or fixed (確定) cannot be changed.',
  inputSchema: z.object({
    date: dateSchema.describe('Date (YYYY-MM-DD).'),
    entries: z
      .array(
        z.object({
          projectId: z.number().int().positive(),
          taskId: z.number().int().positive(),
          minutes: z
            .number()
            .int()
            .min(1)
            .max(DAY_MINUTES)
            .describe('Minutes worked on this task (e.g. 90 = 1.5 hours).'),
        }),
      )
      .min(1)
      .max(50),
  }),
  capability: 'manhours.write',
  audience: 'everyone',
  kind: 'write',
  idempotent: true,
  handler: async (input, ctx) => {
    const keys = input.entries.map((e) => `${e.projectId}/${e.taskId}`);
    if (new Set(keys).size !== keys.length) {
      throw new ToolInputError('The same project task appears more than once in entries.');
    }
    const day = await loadDay(input.date, ctx);

    // タスクの存在確認（取れなければ確認を省く）と名前
    const warnings: string[] = [];
    const tasksByProject = new Map<number, Task[] | undefined>();
    for (const projectId of new Set(input.entries.map((e) => e.projectId))) {
      try {
        tasksByProject.set(projectId, (await ctx.backend.listTasks(projectId)).tasks);
      } catch {
        tasksByProject.set(projectId, undefined);
        warnings.push(`Could not verify tasks of project ${projectId}.`);
      }
    }
    for (const e of input.entries) {
      const tasks = tasksByProject.get(e.projectId);
      if (!tasks) continue;
      const task = tasks.find((t) => t.taskId === e.taskId);
      if (!task) {
        throw new ToolInputError(
          `Task ${e.taskId} is not in project ${e.projectId}. Use list_tasks to find the right taskId.`,
        );
      }
      if (task.finished)
        warnings.push(`Task ${e.taskId} (${task.name}) is marked as finished (終了).`);
    }

    // 同じ日・同じプロジェクトの既存のタスクを残したまま、指定のタスクを上書きする
    const projects = new Map<number, Map<number, number>>();
    for (const e of input.entries) {
      if (!projects.has(e.projectId)) {
        const existing = day?.projects.find((p) => p.projectId === e.projectId)?.items ?? [];
        projects.set(e.projectId, new Map(existing.map((i) => [i.taskId, i.minutes])));
      }
      projects.get(e.projectId)?.set(e.taskId, e.minutes);
    }
    const untouched = (day?.projects ?? [])
      .filter((p) => !projects.has(p.projectId))
      .reduce((sum, p) => sum + p.totalMinutes, 0);
    const payload = [...projects].map(([projectId, items]) => ({
      projectId,
      items: [...items].map(([taskId, minutes]): ManhourItem => ({ taskId, minutes })),
    }));
    const dayTotal = untouched + payload.flatMap((p) => p.items).reduce((s, i) => s + i.minutes, 0);
    if (dayTotal > DAY_MINUTES) {
      throw new ToolInputError(
        `The total for ${input.date} would be ${formatMinutes(dayTotal)}, which exceeds 24 hours.`,
      );
    }

    await ctx.backend.saveManhours({ date: input.date, projects: payload });

    const projectNames = await ctx.backend
      .listProjects()
      .then((r) => new Map(r.projects.map((p) => [p.projectId, p.name])))
      .catch(() => new Map<number, string>());
    return {
      date: input.date,
      saved: input.entries.map((e) => {
        const projectName = projectNames.get(e.projectId);
        const taskName = tasksByProject.get(e.projectId)?.find((t) => t.taskId === e.taskId)?.name;
        return {
          projectId: e.projectId,
          ...(projectName ? { projectName } : {}),
          taskId: e.taskId,
          ...(taskName ? { taskName } : {}),
          minutes: e.minutes,
        };
      }),
      dayTotalMinutes: dayTotal,
      dayTotalHours: formatMinutes(dayTotal),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  },
});

export const deleteManhoursTool = defineTool({
  name: 'delete_manhours',
  title: 'Delete my man-hours',
  description:
    'Delete your own man-hours (工数) for one day and project. If taskId is omitted, ALL tasks of that project on that day are deleted. ' +
    'Days that are closed (締め) or fixed (確定) cannot be changed.',
  inputSchema: z.object({
    date: dateSchema.describe('Date (YYYY-MM-DD).'),
    projectId: z.number().int().positive(),
    taskId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Task to delete. Omit to delete all tasks of the project.'),
  }),
  capability: 'manhours.write',
  audience: 'everyone',
  kind: 'write',
  idempotent: true,
  handler: async (input, ctx) => {
    const day = await loadDay(input.date, ctx);
    const items = day?.projects.find((p) => p.projectId === input.projectId)?.items ?? [];
    const removed =
      input.taskId === undefined ? items : items.filter((i) => i.taskId === input.taskId);
    if (removed.length === 0) {
      return {
        deleted: false,
        date: input.date,
        projectId: input.projectId,
        note: 'There were no man-hours to delete for this project/task on this day.',
      };
    }
    await ctx.backend.deleteManhours({
      date: input.date,
      projectId: input.projectId,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    });
    return { deleted: true, date: input.date, projectId: input.projectId, removed };
  },
});
