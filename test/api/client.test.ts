import { describe, expect, it } from 'vitest';
import { KintaiApiClient } from '../../src/api/client.ts';
import { COMPANY_ID } from '../../src/api/endpoint.ts';
import { KintaiApiError } from '../../src/api/errors.ts';
import { RequestThrottle } from '../../src/api/throttle.ts';
import { createLogger } from '../../src/log.ts';

const TOKEN = 'tok-0123456789-secret';

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(responses: Array<Response | Error | (() => Response | Promise<Response>)>) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const queue = [...responses];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers,
    });
    const next = queue.shift();
    if (next === undefined) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  };
  const client = new KintaiApiClient({
    connection: { host: 'atnd.ak4.jp', companyId: 'acme' },
    getToken: async () => TOKEN,
    fetch: fetchImpl,
    throttle: new RequestThrottle({ minIntervalMs: 0 }),
    retryDelayMs: 0,
    logger: createLogger({ level: 'debug', write: (s) => logs.push(s) }),
  });
  return { client, calls, logs };
}

async function rejection(p: Promise<unknown>): Promise<KintaiApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof KintaiApiError) return e;
    throw e;
  }
  throw new Error('did not reject');
}

describe('KintaiApiClient', () => {
  it('GET はトークンをクエリに付け、response を返す', async () => {
    const { client, calls } = setup([json({ success: true, response: { staff_id: 7 } })]);
    const res = await client.get([COMPANY_ID, 'staffs'], { page: 0 });
    expect(res).toEqual({ staff_id: 7 });
    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe('/api/cooperation/acme/staffs');
    expect(url.searchParams.get('token')).toBe(TOKEN);
    expect(url.searchParams.get('page')).toBe('0');
    expect(calls[0]?.headers['user-agent']).toMatch(/^kintai-plus-mcp\//);
  });

  it('POST はトークンを JSON ボディに入れる', async () => {
    const { client, calls } = setup([json({ success: true, response: { ok: 1 } })]);
    await client.post([COMPANY_ID, 'stamps'], { type: 11 });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toEqual({ type: 11, token: TOKEN });
    expect(calls[0]?.headers['content-type']).toBe('application/json');
    expect(new URL(calls[0]?.url ?? '').searchParams.has('token')).toBe(false);
  });

  it('DELETE はトークンと条件をクエリに付ける', async () => {
    const { client, calls } = setup([json({ success: true, response: null })]);
    await client.delete([COMPANY_ID, 'manhours', 7], { date: '2026/10/27', project_id: 3 });
    expect(calls[0]?.method).toBe('DELETE');
    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('token')).toBe(TOKEN);
    expect(url.searchParams.get('project_id')).toBe('3');
  });

  it('トークンを明示して呼べる（再発行 API 用）', async () => {
    const { client, calls } = setup([json({ success: true, response: {} })]);
    await client.post(['token', 'reissue', COMPANY_ID], {}, { token: 'other-token-value' });
    expect(calls[0]?.body).toEqual({ token: 'other-token-value' });
  });

  it('API エラーは KintaiApiError になり、メッセージ・ログにトークンが出ない', async () => {
    const { client, logs } = setup([
      json({ success: false, errors: [{ code: 'E1', message: `bad token ${TOKEN}` }] }, 400),
    ]);
    const err = await rejection(client.get([COMPANY_ID, 'staffs']));
    // メッセージに token を含むので、4xx でも認証エラーに分類する
    expect(err.kind).toBe('auth');
    expect(err.message).not.toContain(TOKEN);
    expect(logs.join('')).not.toContain(TOKEN);
    expect(logs.join('')).toContain('/api/cooperation/acme/staffs');
  });

  it('通信エラーは network（元のエラーの URL からもトークンを除く）', async () => {
    const { client } = setup([
      new TypeError(`fetch failed for https://atnd.ak4.jp/x?token=${TOKEN}`),
      new TypeError(`fetch failed for https://atnd.ak4.jp/x?token=${TOKEN}`),
    ]);
    const err = await rejection(client.get([COMPANY_ID, 'staffs']));
    expect(err.kind).toBe('network');
    expect(err.message).not.toContain(TOKEN);
    expect(err.cause).toBeUndefined();
  });

  it('タイムアウトは timeout', async () => {
    const abort = () => {
      const e = new Error('The operation was aborted due to timeout');
      e.name = 'TimeoutError';
      return e;
    };
    const { client } = setup([abort(), abort()]);
    expect((await rejection(client.get([COMPANY_ID, 'staffs']))).kind).toBe('timeout');
  });

  it('GET はサーバーエラー・通信エラーのとき 1 回だけ再試行する', async () => {
    const { client, calls } = setup([
      json({ success: false, errors: [] }, 503),
      json({ success: true, response: [1] }),
    ]);
    await expect(client.get([COMPANY_ID, 'alerts'])).resolves.toEqual([1]);
    expect(calls).toHaveLength(2);
  });

  it('POST・DELETE は再試行しない（二重打刻を防ぐ）', async () => {
    const { client, calls } = setup([
      json({ success: false, errors: [] }, 503),
      json({ success: true, response: {} }),
    ]);
    await rejection(client.post([COMPANY_ID, 'stamps'], { type: 11 }));
    expect(calls).toHaveLength(1);
  });

  it('認証エラーなど再試行しても無駄なものは再試行しない', async () => {
    const { client, calls } = setup([json({ success: false, errors: [] }, 401)]);
    expect((await rejection(client.get([COMPANY_ID, 'staffs']))).kind).toBe('auth');
    expect(calls).toHaveLength(1);
  });
});

describe('onResponse（E2E での記録用）', () => {
  it('トークンを伏せた URL と本文を渡す', async () => {
    const seen: Array<{ method: string; url: string; status: number; body: string }> = [];
    const client = new KintaiApiClient({
      connection: { host: 'atnd.ak4.jp', companyId: 'acme' },
      getToken: async () => TOKEN,
      throttle: new RequestThrottle({ minIntervalMs: 0 }),
      fetch: async () =>
        json({ success: true, response: { token: 'new-token-abcdef12', staff_id: 1 } }),
      onResponse: (r) => seen.push(r),
    });
    await client.get([COMPANY_ID, 'staffs']);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.status).toBe(200);
    expect(seen[0]?.url).not.toContain(TOKEN);
    expect(seen[0]?.body).not.toContain('new-token-abcdef12');
    expect(seen[0]?.body).toContain('staff_id');
  });
});
