import { describe, expect, it } from 'vitest';
import { ApiBackend } from '../../src/backend/api-backend.ts';
import { fakeClient } from '../helpers/fake-client.ts';

const projects = Array.from({ length: 60 }, (_, i) => ({ project_id: i + 1, name: `P${i + 1}` }));

function handler(_m: string, url: URL) {
  const page = Number(url.searchParams.get('page') ?? 0);
  if (url.pathname.endsWith('/staffs')) return { staffId: 7 };
  if (url.pathname.endsWith('/projects')) {
    return { projects: projects.slice(page * 50, page * 50 + 50), TotalCount: projects.length };
  }
  if (url.pathname.endsWith('/3/tasks'))
    return { tasks: [{ task_id: 10, name: '設計', is_finished: false }] };
  if (url.pathname.endsWith('/staff_projects/7')) return { project_ids: [3, 55] };
  if (url.pathname.includes('/manhours')) {
    return { dates: [{ date: url.searchParams.get('start_date'), projects: [] }] };
  }
  throw new Error(`unexpected ${url.pathname}`);
}

describe('ApiBackend projects', () => {
  it('listProjects はページを送って全件取り、しばらくキャッシュする', async () => {
    const { client, calls } = fakeClient(handler);
    const backend = new ApiBackend(client);
    const result = await backend.listProjects();
    expect(result.projects).toHaveLength(60);
    expect(result.truncated).toBe(false);
    expect(calls.map((c) => c.url.searchParams.get('page'))).toEqual(['0', '1']);
    await backend.listProjects();
    expect(calls).toHaveLength(2);
  });

  it('listTasks は GET /{c}/{projectId}/tasks', async () => {
    const { client, calls } = fakeClient(handler);
    const result = await new ApiBackend(client).listTasks(3);
    expect(calls[0]?.url.pathname).toBe('/api/cooperation/acme/3/tasks');
    expect(result.tasks).toEqual([{ taskId: 10, name: '設計', finished: false }]);
  });

  it('getMyProjectIds は自分の staffId で GET /{c}/staff_projects/{staffId}', async () => {
    const { client } = fakeClient(handler);
    expect(await new ApiBackend(client).getMyProjectIds()).toEqual([3, 55]);
  });

  it('getManhours は期間を yyyy/mm/dd で渡し、31 日ごとに分割する', async () => {
    const { client, calls } = fakeClient(handler);
    const days = await new ApiBackend(client).getManhours({ from: '2026-09-01', to: '2026-10-15' });
    const mh = calls.filter((c) => c.url.pathname.includes('/manhours'));
    expect(mh[0]?.url.pathname).toBe('/api/cooperation/acme/manhours');
    expect(
      mh.map((c) => [c.url.searchParams.get('start_date'), c.url.searchParams.get('end_date')]),
    ).toEqual([
      ['2026/09/01', '2026/10/01'],
      ['2026/10/02', '2026/10/15'],
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-09-01', '2026-10-02']);
  });

  it('getManhours に staffId を渡すとその人の工数', async () => {
    const { client, calls } = fakeClient(handler);
    await new ApiBackend(client).getManhours(
      { from: '2026-10-01', to: '2026-10-01' },
      { staffId: 9 },
    );
    expect(calls[0]?.url.pathname).toBe('/api/cooperation/acme/manhours/9');
  });
});
