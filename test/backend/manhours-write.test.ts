import { describe, expect, it } from 'vitest';
import { ApiBackend } from '../../src/backend/api-backend.ts';
import { fakeClient } from '../helpers/fake-client.ts';

const handler = (_m: string, url: URL) =>
  url.pathname.endsWith('/staffs') ? { staffId: 7 } : null;

describe('ApiBackend manhours write', () => {
  it('saveManhours は自分の staff_id で POST /{c}/manhours', async () => {
    const { client, calls } = fakeClient(handler);
    await new ApiBackend(client).saveManhours({
      date: '2026-10-27',
      projects: [{ projectId: 3, items: [{ taskId: 10, minutes: 90 }] }],
    });
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url.pathname).toBe('/api/cooperation/acme/manhours');
    expect(post?.body).toEqual({
      manhours: [
        {
          staff_id: 7,
          dates: [
            {
              date: '2026/10/27',
              projects: [{ project_id: 3, daily_hour_items: [{ task_id: 10, minute: 90 }] }],
            },
          ],
        },
      ],
      token: 'test-token-000000',
    });
  });

  it('deleteManhours は DELETE /{c}/manhours/{staffId}（date・project_id 必須、task_id は任意）', async () => {
    const { client, calls } = fakeClient(handler);
    const backend = new ApiBackend(client);
    await backend.deleteManhours({ date: '2026-10-27', projectId: 3, taskId: 10 });
    await backend.deleteManhours({ date: '2026-10-27', projectId: 3 });
    const deletes = calls.filter((c) => c.method === 'DELETE');
    expect(deletes[0]?.url.pathname).toBe('/api/cooperation/acme/manhours/7');
    expect(Object.fromEntries(deletes[0]?.url.searchParams ?? [])).toMatchObject({
      date: '2026/10/27',
      project_id: '3',
      task_id: '10',
    });
    expect(deletes[1]?.url.searchParams.has('task_id')).toBe(false);
  });
});
