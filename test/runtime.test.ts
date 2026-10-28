import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMPANY_ID } from '../src/api/endpoint.ts';
import { NotLoggedInError } from '../src/credentials/token-manager.ts';
import { createRuntime } from '../src/runtime.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kintai-plus-mcp-rt-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createRuntime', () => {
  it('環境変数のトークンを取り込み、初回に再発行してから API を呼ぶ', async () => {
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push(`${init?.method} ${url.pathname}`);
      if (url.pathname.endsWith('/token/reissue/acme')) {
        expect(JSON.parse(String(init?.body)).token).toBe('env-token-0000');
        return Response.json({
          success: true,
          response: { token: 'fresh-token-1111', expired_at: '2026/11/28 09:00:00', staff_id: 9 },
        });
      }
      expect(url.searchParams.get('token')).toBe('fresh-token-1111');
      return Response.json({ success: true, response: { staffId: 9 } });
    };
    const credentialsFile = join(dir, 'credentials.json');
    const logs: string[] = [];
    const runtime = await createRuntime({
      env: {
        KINTAI_PLUS_CREDENTIALS_FILE: credentialsFile,
        KINTAI_PLUS_TOKEN: 'env-token-0000',
        KINTAI_PLUS_COMPANY_ID: 'acme',
        KINTAI_PLUS_MIN_INTERVAL_MS: '100',
      },
      fetch: fetchImpl,
      now: () => new Date('2026-10-27T00:00:00Z'),
      writeLog: (s) => logs.push(s),
    });
    expect(runtime.store.kind).toBe('file');
    const client = await runtime.getClient();
    await client.get([COMPANY_ID, 'staffs']);
    expect(requests).toEqual([
      'POST /api/cooperation/token/reissue/acme',
      'GET /api/cooperation/acme/staffs',
    ]);
    const saved = JSON.parse(await readFile(credentialsFile, 'utf8'));
    expect(saved.token).toBe('fresh-token-1111');
    expect(saved.expiresAt).toBe('2026-11-28T00:00:00.000Z');
    expect(logs.join('')).not.toContain('fresh-token-1111');
    expect(logs.join('')).not.toContain('env-token-0000');
  });

  it('認証情報がなければ getClient が NotLoggedInError', async () => {
    const runtime = await createRuntime({
      env: { KINTAI_PLUS_CREDENTIALS_FILE: join(dir, 'none.json') },
      fetch: async () => Response.json({}),
      writeLog: () => {},
    });
    await expect(runtime.getClient()).rejects.toThrow(NotLoggedInError);
  });
});
