import { describe, expect, it } from 'vitest';
import { ApiBackend } from '../../src/backend/api-backend.ts';
import { fakeClient } from '../helpers/fake-client.ts';

function handler(method: string, url: URL) {
  if (url.pathname.endsWith('/staffs'))
    return { staffId: 7, permissionGroup: { permissionType: 3 } };
  return {
    working_records: [
      {
        date: url.searchParams.get('start_date')?.replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3'),
        working_day_category: 0,
      },
    ],
  };
}

describe('ApiBackend.getWorkingRecords', () => {
  it('自分の分は自分の staffId を指定し、期間は yyyymmdd', async () => {
    const { client, calls } = fakeClient(handler);
    const records = await new ApiBackend(client).getWorkingRecords({
      from: '2026-10-01',
      to: '2026-10-27',
    });
    const wr = calls.filter((c) => c.url.pathname.endsWith('/working_records'));
    expect(wr).toHaveLength(1);
    expect(wr[0]?.url.pathname).toBe('/api/cooperation/acme/working_records');
    expect(wr[0]?.url.searchParams.get('staff_ids')).toBe('7');
    expect(wr[0]?.url.searchParams.get('start_date')).toBe('20261001');
    expect(wr[0]?.url.searchParams.get('end_date')).toBe('20261027');
    expect(records[0]).toMatchObject({ date: '2026-10-01', staffId: 7 });
  });

  it('31 日を超える期間は 31 日ごとに分割する', async () => {
    const { client, calls } = fakeClient(handler);
    const records = await new ApiBackend(client).getWorkingRecords(
      { from: '2026-01-01', to: '2026-03-15' },
      { staffIds: [1, 2] },
    );
    const wr = calls.filter((c) => c.url.pathname.endsWith('/working_records'));
    expect(
      wr.map((c) => [c.url.searchParams.get('start_date'), c.url.searchParams.get('end_date')]),
    ).toEqual([
      ['20260101', '20260131'],
      ['20260201', '20260303'],
      ['20260304', '20260315'],
    ]);
    expect(wr[0]?.url.searchParams.get('staff_ids')).toBe('1,2');
    expect(records.map((r) => r.date)).toEqual(['2026-01-01', '2026-02-01', '2026-03-04']);
    expect(calls.some((c) => c.url.pathname.endsWith('/staffs'))).toBe(false);
  });
});
