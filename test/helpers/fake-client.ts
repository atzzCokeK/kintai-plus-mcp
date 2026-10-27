import { KintaiApiClient } from '../../src/api/client.ts';
import { RequestThrottle } from '../../src/api/throttle.ts';

export interface FakeCall {
  method: string;
  url: URL;
  body: unknown;
}

/** handler の戻り値を `{ success: true, response }` に包んで返す偽の API。Response を返せばそのまま使う。 */
export function fakeClient(handler: (method: string, url: URL, body: unknown) => unknown) {
  const calls: FakeCall[] = [];
  const client = new KintaiApiClient({
    connection: { host: 'atnd.ak4.jp', companyId: 'acme' },
    getToken: async () => 'test-token-000000',
    throttle: new RequestThrottle({ minIntervalMs: 0 }),
    retryDelayMs: 0,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, body });
      const result = handler(method, url, body);
      if (result instanceof Response) return result;
      return Response.json({ success: true, response: result });
    },
  });
  return { client, calls };
}
