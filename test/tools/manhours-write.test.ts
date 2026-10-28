import { describe, expect, it } from 'vitest';
import type { ManhourDay } from '../../src/api/manhours.ts';
import type { SaveManhoursInput } from '../../src/backend/types.ts';
import { deleteManhoursTool, saveManhoursTool } from '../../src/tools/manhours-write.ts';
import { ToolInputError, ToolRefusedError } from '../../src/tools/result.ts';
import { fakeBackend, fakeContext } from '../helpers/fake-backend.ts';

const existingDay = (overrides: Partial<ManhourDay> = {}): ManhourDay => ({
  date: '2026-10-27',
  closed: false,
  fixed: false,
  totalMinutes: 180,
  projects: [
    {
      projectId: 3,
      totalMinutes: 120,
      items: [
        { taskId: 10, minutes: 60 },
        { taskId: 11, minutes: 60 },
      ],
    },
    { projectId: 4, totalMinutes: 60, items: [{ taskId: 20, minutes: 60 }] },
  ],
  ...overrides,
});

function setup(day: ManhourDay | undefined = existingDay()) {
  const saved: SaveManhoursInput[] = [];
  const deleted: unknown[] = [];
  const backend = fakeBackend({
    getManhours: async () => (day ? [day] : []),
    listProjects: async () => ({
      projects: [
        { projectId: 3, name: '社内基盤' },
        { projectId: 5, name: '新規' },
      ],
      truncated: false,
    }),
    listTasks: async (projectId) => ({
      tasks:
        projectId === 3
          ? [
              { taskId: 10, name: '設計', finished: false },
              { taskId: 11, name: '実装', finished: false },
              { taskId: 12, name: '旧', finished: true },
            ]
          : [{ taskId: 50, name: '調査', finished: false }],
      truncated: false,
    }),
    saveManhours: async (input) => {
      saved.push(input);
    },
    deleteManhours: async (input) => {
      deleted.push(input);
    },
  });
  return { ctx: fakeContext(backend), saved, deleted };
}

describe('save_manhours', () => {
  it('指定したタスクだけ上書きし、同じプロジェクトの他のタスクは保つ', async () => {
    const { ctx, saved } = setup();
    const out = await saveManhoursTool.handler(
      {
        date: '2026-10-27',
        entries: [
          { projectId: 3, taskId: 10, minutes: 90 },
          { projectId: 5, taskId: 50, minutes: 30 },
        ],
      },
      ctx,
    );
    expect(saved).toEqual([
      {
        date: '2026-10-27',
        projects: [
          {
            projectId: 3,
            items: [
              { taskId: 10, minutes: 90 },
              { taskId: 11, minutes: 60 },
            ],
          },
          { projectId: 5, items: [{ taskId: 50, minutes: 30 }] },
        ],
      },
    ]);
    expect(out).toMatchObject({
      date: '2026-10-27',
      saved: [
        { projectId: 3, projectName: '社内基盤', taskId: 10, taskName: '設計', minutes: 90 },
        { projectId: 5, projectName: '新規', taskId: 50, taskName: '調査', minutes: 30 },
      ],
      dayTotalMinutes: 240,
      dayTotalHours: '4:00',
    });
  });

  it('締め・確定済みの日は保存しない', async () => {
    for (const day of [existingDay({ closed: true }), existingDay({ fixed: true })]) {
      const { ctx, saved } = setup(day);
      await expect(
        saveManhoursTool.handler(
          { date: '2026-10-27', entries: [{ projectId: 3, taskId: 10, minutes: 30 }] },
          ctx,
        ),
      ).rejects.toThrow(ToolRefusedError);
      expect(saved).toEqual([]);
    }
  });

  it('プロジェクトにないタスクは弾く。終了したタスクは警告付きで保存', async () => {
    const { ctx, saved } = setup(undefined);
    await expect(
      saveManhoursTool.handler(
        { date: '2026-10-27', entries: [{ projectId: 3, taskId: 999, minutes: 30 }] },
        ctx,
      ),
    ).rejects.toThrow(/999/);
    const out = await saveManhoursTool.handler(
      { date: '2026-10-27', entries: [{ projectId: 3, taskId: 12, minutes: 30 }] },
      ctx,
    );
    expect(saved).toHaveLength(1);
    expect(JSON.stringify(out)).toMatch(/finished/);
  });

  it('同じタスクの重複・1 日 24 時間超えは入力エラー', async () => {
    const { ctx } = setup();
    await expect(
      saveManhoursTool.handler(
        {
          date: '2026-10-27',
          entries: [
            { projectId: 3, taskId: 10, minutes: 30 },
            { projectId: 3, taskId: 10, minutes: 40 },
          ],
        },
        ctx,
      ),
    ).rejects.toThrow(ToolInputError);
    await expect(
      saveManhoursTool.handler(
        { date: '2026-10-27', entries: [{ projectId: 3, taskId: 10, minutes: 1400 }] },
        ctx,
      ),
    ).rejects.toThrow(/24 hours/);
  });

  it('不正な日付は入力エラー', async () => {
    const { ctx } = setup();
    await expect(
      saveManhoursTool.handler(
        { date: '2026-02-30', entries: [{ projectId: 3, taskId: 10, minutes: 30 }] },
        ctx,
      ),
    ).rejects.toThrow(ToolInputError);
  });
});

describe('delete_manhours', () => {
  it('タスクを指定して削除し、消した内容を返す', async () => {
    const { ctx, deleted } = setup();
    const out = await deleteManhoursTool.handler(
      { date: '2026-10-27', projectId: 3, taskId: 11 },
      ctx,
    );
    expect(deleted).toEqual([{ date: '2026-10-27', projectId: 3, taskId: 11 }]);
    expect(out).toMatchObject({ deleted: true, removed: [{ taskId: 11, minutes: 60 }] });
  });

  it('タスクを省略するとそのプロジェクトの全タスク', async () => {
    const { ctx, deleted } = setup();
    const out = await deleteManhoursTool.handler({ date: '2026-10-27', projectId: 3 }, ctx);
    expect(deleted).toEqual([{ date: '2026-10-27', projectId: 3 }]);
    expect(out).toMatchObject({ removed: [{ taskId: 10 }, { taskId: 11 }] });
  });

  it('消すものがなければ API を呼ばない', async () => {
    const { ctx, deleted } = setup();
    const out = await deleteManhoursTool.handler({ date: '2026-10-27', projectId: 9 }, ctx);
    expect(deleted).toEqual([]);
    expect(out).toMatchObject({ deleted: false });
  });

  it('締め・確定済みの日は削除しない', async () => {
    const { ctx, deleted } = setup(existingDay({ fixed: true }));
    await expect(
      deleteManhoursTool.handler({ date: '2026-10-27', projectId: 3 }, ctx),
    ).rejects.toThrow(ToolRefusedError);
    expect(deleted).toEqual([]);
  });
});
