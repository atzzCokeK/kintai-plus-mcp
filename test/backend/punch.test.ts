import { describe, expect, it } from 'vitest';
import { ApiBackend } from '../../src/backend/api-backend.ts';
import { fakeClient } from '../helpers/fake-client.ts';

describe('ApiBackend.punch', () => {
  it('種別を必ず指定して POST /{c}/stamps（自動判定は使わない）', async () => {
    const { client, calls } = fakeClient(() => ({ stamped_at: '2026/10/27 10:00:03', type: 11 }));
    const result = await new ApiBackend(client).punch({
      type: 'clock_in',
      at: new Date('2026-10-27T01:00:00Z'),
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.pathname).toBe('/api/cooperation/acme/stamps');
    expect(calls[0]?.body).toEqual({
      type: 11,
      stampedAt: '2026/10/27 10:00:00',
      timezone: '+09:00',
      token: 'test-token-000000',
    });
    expect(result.stampedAt?.toISOString()).toBe('2026-10-27T01:00:03.000Z');
  });

  it('テレワークは telework: 1 を付ける', async () => {
    const { client, calls } = fakeClient(() => null);
    const result = await new ApiBackend(client).punch({
      type: 'clock_in',
      telework: true,
      at: new Date('2026-10-27T01:00:00Z'),
    });
    expect(calls[0]?.body).toMatchObject({ type: 11, telework: 1 });
    expect(result.stampedAt).toBeUndefined();
  });
});
