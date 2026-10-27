import { describe, expect, it } from 'vitest';
import { ApiBackend } from '../../src/backend/api-backend.ts';
import { fakeClient } from '../helpers/fake-client.ts';

function stampsResponse(n: number, day = '2026/10/27') {
  return {
    stamps: Array.from({ length: n }, (_, i) => ({
      stamped_at: `${day} ${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`,
      type: 11,
    })),
  };
}

describe('ApiBackend.getStamps', () => {
  it('自分の打刻を、日本時間の 00:00:00〜23:59:59 で取得する', async () => {
    const { client, calls } = fakeClient(() => stampsResponse(2));
    const result = await new ApiBackend(client).getStamps({ from: '2026-10-27', to: '2026-10-27' });
    expect(result.stamps).toHaveLength(2);
    expect(result.truncated).toBe(false);
    const url = calls[0]?.url;
    expect(url?.pathname).toBe('/api/cooperation/acme/stamps');
    expect(url?.searchParams.get('start_date')).toBe('20261027000000');
    expect(url?.searchParams.get('end_date')).toBe('20261027235959');
  });

  it('従業員を指定するとその人の打刻（パスに staffId）', async () => {
    const { client, calls } = fakeClient(() => stampsResponse(0));
    await new ApiBackend(client).getStamps(
      { from: '2026-10-27', to: '2026-10-27' },
      { staffId: 42 },
    );
    expect(calls[0]?.url.pathname).toBe('/api/cooperation/acme/stamps/42');
  });

  it('6 ヶ月を超える期間は分割して取得する', async () => {
    const { client, calls } = fakeClient(() => stampsResponse(0));
    await new ApiBackend(client).getStamps({ from: '2026-01-01', to: '2026-12-31' });
    expect(
      calls.map((c) => [c.url.searchParams.get('start_date'), c.url.searchParams.get('end_date')]),
    ).toEqual([
      ['20260101000000', '20260630235959'],
      ['20260701000000', '20261231235959'],
    ]);
  });

  it('1 回で 1000 件に達したら、区間を半分にして取り直す', async () => {
    const { client, calls } = fakeClient((_m, url) => {
      const start = url.searchParams.get('start_date');
      return start === '20261001000000' && url.searchParams.get('end_date') === '20261004235959'
        ? stampsResponse(1000)
        : stampsResponse(3);
    });
    const result = await new ApiBackend(client).getStamps({ from: '2026-10-01', to: '2026-10-04' });
    expect(calls.map((c) => c.url.searchParams.get('start_date'))).toEqual([
      '20261001000000',
      '20261001000000',
      '20261003000000',
    ]);
    expect(result.stamps).toHaveLength(6);
    expect(result.truncated).toBe(false);
  });

  it('1 日で 1000 件に達したら truncated を立てる', async () => {
    const { client } = fakeClient(() => stampsResponse(1000));
    const result = await new ApiBackend(client).getStamps({ from: '2026-10-27', to: '2026-10-27' });
    expect(result.truncated).toBe(true);
  });
});
