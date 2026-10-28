import { describe, expect, it } from 'vitest';
import { KintaiApiClient } from '../../src/api/client.ts';
import { RequestThrottle } from '../../src/api/throttle.ts';
import { reissueToken } from '../../src/api/token.ts';

function clientReturning(body: unknown, seen: { url?: string; body?: unknown }) {
  return new KintaiApiClient({
    connection: { host: 'atnd.ak4.jp', companyId: 'acme' },
    getToken: async () => 'should-not-be-used',
    throttle: new RequestThrottle({ minIntervalMs: 0 }),
    fetch: async (input, init) => {
      seen.url = String(input);
      seen.body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(body), { status: 200 });
    },
  });
}

describe('reissueToken', () => {
  it('POST /token/reissue/{companyId} に現在のトークンを送り、新しいトークンと期限を返す', async () => {
    const seen: { url?: string; body?: unknown } = {};
    const client = clientReturning(
      {
        success: true,
        response: {
          login_company_code: 'acme',
          staff_id: 42,
          token: 'new-token-abcdef',
          expired_at: '2026/11/28 10:00:00',
        },
      },
      seen,
    );
    const result = await reissueToken(client, 'old-token-123456');
    expect(seen.url).toBe('https://atnd.ak4.jp/api/cooperation/token/reissue/acme');
    expect(seen.body).toEqual({ token: 'old-token-123456' });
    expect(result).toEqual({
      token: 'new-token-abcdef',
      expiresAt: new Date('2026-11-28T01:00:00Z'),
      staffId: 42,
    });
  });

  it('応答にトークンや期限がなければ invalid_response', async () => {
    const client = clientReturning({ success: true, response: { staff_id: 1 } }, {});
    await expect(reissueToken(client, 'old-token-123456')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});
