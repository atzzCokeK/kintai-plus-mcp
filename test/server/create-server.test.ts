import { afterEach, describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { KintaiApiError } from '../../src/api/errors.ts';
import { createMcpServer } from '../../src/server/create-server.ts';
import { getMyProfileTool } from '../../src/tools/profile.ts';
import { defineTool } from '../../src/tools/registry.ts';
import { fakeContext } from '../helpers/fake-backend.ts';
import { connectTestClient } from '../helpers/mcp-client.ts';

const failing = defineTool({
  name: 'always_fails',
  title: 'Always fails',
  description: 'test',
  inputSchema: z.object({ n: z.number().int() }),
  capability: 'profile',
  audience: 'everyone',
  kind: 'write',
  handler: async () => {
    throw new KintaiApiError({ kind: 'auth', message: 'expired' });
  },
});

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

describe('createMcpServer', () => {
  it('ツールを登録し、注釈と入力スキーマを公開する', async () => {
    const server = createMcpServer(fakeContext(), [getMyProfileTool, failing]);
    const client = await connectTestClient(server);
    close = client.close;
    expect((client.init.result as { serverInfo: { name: string } }).serverInfo.name).toBe(
      'kintai-plus-mcp',
    );
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['get_my_profile', 'always_fails']);
    expect(tools[0]?.annotations).toMatchObject({ readOnlyHint: true });
    expect(tools[1]?.annotations).toMatchObject({ destructiveHint: true });
    expect(tools[1]?.inputSchema).toMatchObject({ properties: { n: { type: 'integer' } } });
  });

  it('ツールの結果を JSON テキストで返す', async () => {
    const client = await connectTestClient(createMcpServer(fakeContext(), [getMyProfileTool]));
    close = client.close;
    const res = await client.callTool('get_my_profile');
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({ staffId: 1, role: 'employee' });
  });

  it('失敗は isError とヒントで返し、認証エラーなら onAuthError を呼ぶ', async () => {
    let authErrors = 0;
    const server = createMcpServer(fakeContext(), [failing], { onAuthError: () => authErrors++ });
    const client = await connectTestClient(server);
    close = client.close;
    const res = await client.callTool('always_fails', { n: 1 });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/login/);
    expect(authErrors).toBe(1);
  });

  it('入力スキーマに合わない引数はエラーで返す', async () => {
    const client = await connectTestClient(createMcpServer(fakeContext(), [failing]));
    close = client.close;
    const res = await client.callTool('always_fails', { n: 'x' });
    expect(res.isError).toBe(true);
  });
});
