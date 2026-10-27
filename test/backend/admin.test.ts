import { describe, expect, it } from 'vitest';
import { ApiBackend } from '../../src/backend/api-backend.ts';
import { fakeClient } from '../helpers/fake-client.ts';

const staff = Array.from({ length: 45 }, (_, i) => ({ staffId: i + 1, name: `S${i + 1}` }));

describe('ApiBackend admin', () => {
  it('listStaff は 20 人/ページ（0 始まり）でページを送る', async () => {
    const { client, calls } = fakeClient((_m, url) => {
      const page = Number(url.searchParams.get('page'));
      return { staffs: staff.slice(page * 20, page * 20 + 20), TotalCount: 45 };
    });
    const result = await new ApiBackend(client).listStaff();
    expect(result.staff).toHaveLength(45);
    expect(result.totalCount).toBe(45);
    expect(calls.map((c) => c.url.searchParams.get('page'))).toEqual(['0', '1', '2']);
  });

  it('getTeamStamps は 1 日分を 50 人ずつ multiple_stamps で取る', async () => {
    const { client, calls } = fakeClient((_m, url) => ({
      staffs: (url.searchParams.get('staff_ids') ?? '').split(',').map((id) => ({
        staff_id: Number(id),
        stamps: [{ stamped_at: '2026/10/27 09:00:00', type: 11 }],
      })),
    }));
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    const result = await new ApiBackend(client).getTeamStamps('2026-10-27', ids);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.url.pathname).toBe('/api/cooperation/acme/multiple_stamps');
    expect(calls[0]?.url.searchParams.get('staff_ids')?.split(',')).toHaveLength(50);
    expect(calls[0]?.url.searchParams.get('start_date')).toBe('20261027000000');
    expect(calls[0]?.url.searchParams.get('end_date')).toBe('20261027235959');
    expect(result.stamps).toHaveLength(120);
    expect(new Set(result.stamps.map((s) => s.staffId)).size).toBe(120);
  });

  it('getTeamStamps は 1000 件に達したら人数を半分にして取り直す', async () => {
    const { client, calls } = fakeClient((_m, url) => {
      const ids = (url.searchParams.get('staff_ids') ?? '').split(',');
      const n = ids.length === 4 ? 1000 : 2;
      return {
        staffs: ids.map((id) => ({
          staff_id: Number(id),
          stamps: Array.from({ length: n / ids.length }, () => ({
            stamped_at: '2026/10/27 09:00:00',
            type: 11,
          })),
        })),
      };
    });
    const result = await new ApiBackend(client).getTeamStamps('2026-10-27', [1, 2, 3, 4]);
    expect(calls.map((c) => c.url.searchParams.get('staff_ids'))).toEqual([
      '1,2,3,4',
      '1,2',
      '3,4',
    ]);
    expect(result.truncated).toBe(false);
  });

  it('getWorkingStatuses は POST /working_statuses/search（企業 ID はボディ）', async () => {
    const { client, calls } = fakeClient(() => [{ staff_id: 1, date: '2026-10-27', name: '出張' }]);
    const result = await new ApiBackend(client).getWorkingStatuses([
      { staffId: 1, date: '2026-10-27' },
    ]);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.pathname).toBe('/api/cooperation/working_statuses/search');
    expect(calls[0]?.body).toMatchObject({
      login_company_code: 'acme',
      search: [{ staff_id: 1, date: '2026-10-27' }],
    });
    expect(result).toEqual([{ staffId: 1, date: '2026-10-27', labels: ['出張'] }]);
  });

  it('getProjectMembers は GET /{c}/project_staffs/{projectId}', async () => {
    const { client, calls } = fakeClient(() => ({ staff_ids: [1, 2], owner_staff_ids: [1] }));
    expect(await new ApiBackend(client).getProjectMembers(3)).toEqual({
      staffIds: [1, 2],
      ownerStaffIds: [1],
    });
    expect(calls[0]?.url.pathname).toBe('/api/cooperation/acme/project_staffs/3');
  });
});
