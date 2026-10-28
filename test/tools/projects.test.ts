import { describe, expect, it } from 'vitest';
import type { DateRange } from '../../src/api/paging.ts';
import type { Project } from '../../src/api/projects.ts';
import {
  getManhoursTool,
  getMyProjectsTool,
  listProjectsTool,
  listTasksTool,
} from '../../src/tools/projects.ts';
import { fakeBackend, fakeContext } from '../helpers/fake-backend.ts';

const NOW = new Date('2026-10-27T01:00:00Z');
const projects: Project[] = [
  { projectId: 1, name: '社内基盤', code: 'P1', startDate: '2026-01-01' },
  { projectId: 2, name: '旧案件', endDate: '2025-12-31' },
  { projectId: 3, name: '新規開発', shortName: '新規', startDate: '2026-11-01' },
];
const backend = fakeBackend({
  listProjects: async () => ({ projects, truncated: false }),
  listTasks: async (projectId) => ({
    tasks:
      projectId === 1
        ? [
            { taskId: 10, name: '設計', finished: false, estimatedMinutes: 600 },
            { taskId: 11, name: '完了済み', finished: true },
          ]
        : [],
    truncated: false,
  }),
  getMyProjectIds: async () => [1, 99],
});

describe('list_projects', () => {
  it('すべてのプロジェクトを返す', async () => {
    const out = (await listProjectsTool.handler({}, fakeContext(backend, {}, NOW))) as {
      count: number;
    };
    expect(out.count).toBe(3);
  });

  it('名前・コードで絞り込み、指定日に有効なものだけにできる', async () => {
    const byQuery = (await listProjectsTool.handler(
      { query: '新規' },
      fakeContext(backend, {}, NOW),
    )) as {
      projects: Project[];
    };
    expect(byQuery.projects.map((p) => p.projectId)).toEqual([3]);
    const active = (await listProjectsTool.handler(
      { activeOn: '2026-10-27' },
      fakeContext(backend, {}, NOW),
    )) as {
      projects: Project[];
    };
    expect(active.projects.map((p) => p.projectId)).toEqual([1]);
  });
});

describe('list_tasks', () => {
  it('既定では終了したタスクを除く。見積もりは H:MM も付ける', async () => {
    const out = await listTasksTool.handler({ projectId: 1 }, fakeContext(backend, {}, NOW));
    expect(out).toEqual({
      projectId: 1,
      count: 1,
      tasks: [
        {
          taskId: 10,
          name: '設計',
          finished: false,
          estimatedMinutes: 600,
          estimatedHours: '10:00',
        },
      ],
    });
    const all = (await listTasksTool.handler(
      { projectId: 1, includeFinished: true },
      fakeContext(backend),
    )) as {
      count: number;
    };
    expect(all.count).toBe(2);
  });
});

describe('get_my_projects', () => {
  it('参加プロジェクトを名前付きで返す（一覧にない ID は ID だけ）', async () => {
    const out = await getMyProjectsTool.handler({}, fakeContext(backend, {}, NOW));
    expect(out).toEqual({
      count: 2,
      projects: [
        { projectId: 1, name: '社内基盤', code: 'P1', startDate: '2026-01-01' },
        { projectId: 99 },
      ],
    });
  });
});

describe('get_manhours', () => {
  it('既定は今月。プロジェクト名・タスク名を補い、合計を返す', async () => {
    const seen: DateRange[] = [];
    const b = fakeBackend({
      ...backend,
      getManhours: async (range) => {
        seen.push(range);
        return [
          {
            date: '2026-10-01',
            closed: false,
            fixed: false,
            totalMinutes: 150,
            projects: [
              {
                projectId: 1,
                totalMinutes: 150,
                items: [
                  { taskId: 10, minutes: 120 },
                  { taskId: 77, minutes: 30 },
                ],
              },
            ],
          },
        ];
      },
    });
    const out = await getManhoursTool.handler({}, fakeContext(b, {}, NOW));
    expect(seen).toEqual([{ from: '2026-10-01', to: '2026-10-31' }]);
    expect(out).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      totalMinutes: 150,
      totalHours: '2:30',
      days: [
        {
          date: '2026-10-01',
          closed: false,
          fixed: false,
          totalMinutes: 150,
          projects: [
            {
              projectId: 1,
              projectName: '社内基盤',
              totalMinutes: 150,
              items: [
                { taskId: 10, taskName: '設計', minutes: 120 },
                { taskId: 77, minutes: 30 },
              ],
            },
          ],
        },
      ],
    });
  });

  it('名前の取得に失敗しても工数は返す', async () => {
    const b = fakeBackend({
      listProjects: async () => {
        throw new Error('down');
      },
      getManhours: async () => [
        {
          date: '2026-10-01',
          closed: true,
          fixed: true,
          totalMinutes: 60,
          projects: [{ projectId: 1, totalMinutes: 60, items: [{ taskId: 10, minutes: 60 }] }],
        },
      ],
    });
    const out = (await getManhoursTool.handler(
      { from: '2026-10-01', to: '2026-10-01' },
      fakeContext(b, {}, NOW),
    )) as {
      days: Array<{ projects: Array<Record<string, unknown>> }>;
    };
    expect(out.days[0]?.projects[0]).toEqual({
      projectId: 1,
      totalMinutes: 60,
      items: [{ taskId: 10, minutes: 60 }],
    });
  });
});
