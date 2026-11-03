import { describe, expect, it } from 'vitest';
import { ApiBackend } from '../../src/backend/api-backend.ts';
import { fakeClient } from '../helpers/fake-client.ts';

function handler(_method: string, url: URL) {
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
    expect(wr[0]?.url.searchParams.get('include_actual_working_hours_no_rounding')).toBe('1');
    expect(wr[0]?.url.searchParams.get('include_break_results')).toBeNull();
  });

  it('51 人は 50 人ずつに分ける', async () => {
    const { client, calls } = fakeClient(handler);
    const ids = Array.from({ length: 51 }, (_, i) => i + 1);
    await new ApiBackend(client).getWorkingRecords(
      { from: '2026-10-01', to: '2026-10-03' },
      { staffIds: ids },
    );
    const wr = calls.filter((c) => c.url.pathname.endsWith('/working_records'));
    expect(wr.map((c) => c.url.searchParams.get('staff_ids')?.split(',').length)).toEqual([50, 1]);
    expect(wr[1]?.url.searchParams.get('staff_ids')).toBe('51');
  });

  it('1 日は休憩実績を end_date なしで追加し、期間外の日は捨てる', async () => {
    const { client, calls } = fakeClient((_method, url) => {
      const start = url.searchParams.get('start_date') ?? '';
      const date = start.replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3');
      if (url.searchParams.get('include_break_results') === '1') {
        return {
          working_records: [
            {
              date,
              working_day_category: 0,
              start_time: `${date} 09:00:00`,
              end_time: `${date} 18:00:00`,
              break_time_results: [
                {
                  result_break_time_start_time: `${date} 12:00:00`,
                  result_break_time_end_time: `${date} 13:00:00`,
                },
              ],
            },
          ],
        };
      }
      return {
        working_records: [
          { date, working_day_category: 0 },
          { date: '2026/10/02', working_day_category: 0 },
        ],
      };
    });
    const records = await new ApiBackend(client).getWorkingRecords(
      { from: '2026-10-01', to: '2026-10-01' },
      { staffIds: [4] },
    );
    const wr = calls.filter((c) => c.url.pathname.endsWith('/working_records'));
    expect(wr).toHaveLength(2);
    expect(wr[0]?.url.searchParams.get('end_date')).toBe('20261001');
    expect(wr[0]?.url.searchParams.get('include_break_results')).toBeNull();
    expect(wr[1]?.url.searchParams.get('end_date')).toBeNull();
    expect(wr[1]?.url.searchParams.get('include_break_results')).toBe('1');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ date: '2026-10-01', staffId: 4, breakMinutes: 60 });
  });

  it('追加パラメータが 400 なら付けずに取り直し、休憩の追加が 400 でも先の結果を使う', async () => {
    let n = 0;
    const { client, calls } = fakeClient(() => {
      n += 1;
      if (n === 1) {
        return Response.json(
          { success: false, errors: [{ code: 'ERR301001', message: 'bad date' }] },
          { status: 400 },
        );
      }
      return { working_records: [{ date: '2026/10/01', working_day_category: 0 }] };
    });
    const records = await new ApiBackend(client).getWorkingRecords(
      { from: '2026-10-01', to: '2026-10-03' },
      { staffIds: [4] },
    );
    const wr = calls.filter((c) => c.url.pathname.endsWith('/working_records'));
    expect(wr).toHaveLength(2);
    expect(wr[1]?.url.searchParams.get('include_actual_working_hours_no_rounding')).toBeNull();
    expect(records[0]).toMatchObject({ date: '2026-10-01', staffId: 4 });

    let single = 0;
    const second = fakeClient((_method, url) => {
      single += 1;
      if (url.searchParams.get('include_break_results') === '1') {
        return Response.json(
          { success: false, errors: [{ code: 'ERR301001', message: 'bad date' }] },
          { status: 400 },
        );
      }
      return {
        working_records: [
          { date: '2026/10/05', working_day_category: 0 },
          { date: '2026/10/06', working_day_category: 0 },
        ],
      };
    });
    const oneDay = await new ApiBackend(second.client).getWorkingRecords(
      { from: '2026-10-05', to: '2026-10-05' },
      { staffIds: [4] },
    );
    expect(single).toBe(2);
    expect(oneDay.map((r) => r.date)).toEqual(['2026-10-05']);
  });

  it('パラメータ以外の失敗は握りつぶさない', async () => {
    const { client } = fakeClient(() =>
      Response.json(
        { success: false, errors: [{ code: 'ERR999999', message: 'no' }] },
        { status: 403 },
      ),
    );
    await expect(
      new ApiBackend(client).getWorkingRecords(
        { from: '2026-10-01', to: '2026-10-02' },
        { staffIds: [4] },
      ),
    ).rejects.toThrow(/403/);
  });
});
