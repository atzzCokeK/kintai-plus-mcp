import * as z from 'zod/v4';
import type { ManhourDay, ManhourItem } from '../api/manhours.ts';
import type { Task } from '../api/projects.ts';
import { isValidLocalDate, type LocalDate } from '../time/datetime.ts';
import { dateSchema, formatMinutes, writeConfirmField } from './common.ts';
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
      'Do not retry save_manhours or delete_manhours for this date. Ask the user to have the day reopened in the Kintai Plus web UI.',
    );
  }
  return day;
}

export const saveManhoursTool = defineTool({
  name: 'save_manhours',
  title: 'Save my man-hours',
  description:
    'WRITE. Create or update YOUR man-hours (工数) for one date (YYYY-MM-DD, Japan time): minutes per project task. ' +
    'Only the tasks you list are overwritten; other tasks that day are kept. Removing an entry is delete_manhours, not a zero. ' +
    'Confirm the project, task, and minutes with the user before calling. Idempotent for the same entries. ' +
    'Refuses a day that is closed (締め) or fixed (確定) — do not retry; it must be reopened in the web UI. ' +
    'Find IDs with get_my_projects (prefer it over list_projects) and list_tasks. close_out tells you which dates are missing. ' +
    'If this tool is not listed, the server is read-only (KINTAI_PLUS_READ_ONLY).',
  inputSchema: z.object({
    date: dateSchema.describe('Date to save (YYYY-MM-DD, Japan time). Required. No default.'),
    entries: z
      .array(
        z.strictObject({
          projectId: z.number().int().positive().describe('From get_my_projects or list_projects.'),
          taskId: z
            .number()
            .int()
            .positive()
            .describe('From list_tasks for that projectId. Must belong to the project.'),
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
    confirm: writeConfirmField,
  }),
  capability: 'manhours.write',
  audience: 'everyone',
  kind: 'write',
  /** 指定したタスクの分数を置き換える。消すのは delete_manhours */
  destructive: false,
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

    await ctx.confirm(
      `Save man-hours for ${input.date}: ` +
        input.entries
          .map((e) => `project ${e.projectId} / task ${e.taskId}: ${formatMinutes(e.minutes)}`)
          .join(', ') +
        `? Day total will be ${formatMinutes(dayTotal)}.`,
    );
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
    'WRITE. Delete YOUR man-hours (工数) for one date (YYYY-MM-DD, Japan time) and projectId. ' +
    'If taskId is omitted, ALL tasks of that project on that day are deleted — confirm that explicitly with the user. ' +
    'Idempotent: deleting what is already gone returns deleted:false and changes nothing. ' +
    'Closed (締め) or fixed (確定) days cannot be changed; do not retry. ' +
    'If this tool is not listed, the server is read-only (KINTAI_PLUS_READ_ONLY).',
  inputSchema: z.object({
    date: dateSchema.describe('Date (YYYY-MM-DD, Japan time). Required.'),
    projectId: z
      .number()
      .int()
      .positive()
      .describe('Project whose man-hours to delete. From get_manhours or get_my_projects.'),
    taskId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'One task to delete. Omit only when the user wants every task of this project on that day removed.',
      ),
    confirm: writeConfirmField,
  }),
  capability: 'manhours.write',
  audience: 'everyone',
  kind: 'write',
  /** 工数を消す。確認レベル destructive の対象 */
  destructive: true,
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
    await ctx.confirm(
      `Delete man-hours for ${input.date}, project ${input.projectId}: ` +
        removed.map((i) => `task ${i.taskId} (${formatMinutes(i.minutes)})`).join(', ') +
        '?',
    );
    await ctx.backend.deleteManhours({
      date: input.date,
      projectId: input.projectId,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    });
    return { deleted: true, date: input.date, projectId: input.projectId, removed };
  },
});
