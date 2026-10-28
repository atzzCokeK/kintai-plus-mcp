import { describe, expect, it } from 'vitest';
import { ApiBackend } from '../../src/backend/api-backend.ts';
import { getAlertsTool } from '../../src/tools/alerts.ts';
import { fakeBackend, fakeContext } from '../helpers/fake-backend.ts';
import { fakeClient } from '../helpers/fake-client.ts';

describe('ApiBackend.getAlerts', () => {
  it('GET /{c}/alerts', async () => {
    const { client, calls } = fakeClient(() => ({
      alerts: [{ month: '2026/10', date: '2026/10/01', alert_type: 1 }],
    }));
    const alerts = await new ApiBackend(client).getAlerts();
    expect(calls[0]?.url.pathname).toBe('/api/cooperation/acme/alerts');
    expect(alerts).toEqual([{ month: '2026-10', date: '2026-10-01', type: 1, label: '打刻忘れ' }]);
  });
});

describe('get_alerts', () => {
  const backend = fakeBackend({
    getAlerts: async () => [
      { month: '2026-09', date: '2026-09-30', type: 7, label: '遅刻' },
      { month: '2026-10', date: '2026-10-02', type: 1, label: '打刻忘れ' },
      { month: '2026-10', type: 13, label: '36協定' },
    ],
  });

  it('すべてのアラートを返す', async () => {
    const out = await getAlertsTool.handler({}, fakeContext(backend));
    expect(out).toMatchObject({ count: 3 });
  });

  it('月で絞り込める（API では絞り込めないためサーバー側で）', async () => {
    const out = (await getAlertsTool.handler({ month: '2026-10' }, fakeContext(backend))) as {
      alerts: unknown[];
    };
    expect(out.alerts).toEqual([
      { month: '2026-10', date: '2026-10-02', type: 1, label: '打刻忘れ' },
      { month: '2026-10', type: 13, label: '36協定' },
    ]);
  });
});
