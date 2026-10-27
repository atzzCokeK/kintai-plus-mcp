import { afterEach, describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { createMcpServer } from '../../src/server/create-server.ts';
import { defineTool } from '../../src/tools/registry.ts';
import { fakeContext } from '../helpers/fake-backend.ts';
import { connectTestClient } from '../helpers/mcp-client.ts';

let executed = 0;
const writeTool = defineTool({
  name: 'do_write',
  title: 'Do write',
  description: 'test',
  inputSchema: z.object({ what: z.string() }),
  capability: 'profile',
  audience: 'everyone',
  kind: 'write',
  handler: async (input, ctx) => {
    await ctx.confirm(`Really write ${input.what}?`);
    executed++;
    return { done: input.what };
  },
});
const readTool = defineTool({
  name: 'do_read',
  title: 'Do read',
  description: 'test',
  inputSchema: z.object({}),
  capability: 'profile',
  audience: 'everyone',
  kind: 'read',
  handler: async () => ({ ok: true }),
});

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  executed = 0;
  await close?.();
  close = undefined;
});

const ELICIT = { elicitation: { form: {} } };

async function connect(
  env: Record<string, string>,
  answer?: unknown,
  capabilities: Record<string, unknown> = ELICIT,
) {
  const server = createMcpServer(fakeContext(undefined, env), [writeTool, readTool]);
  const client = await connectTestClient(server, {
    capabilities,
    onServerRequest: (method) => (method === 'elicitation/create' ? answer : undefined),
  });
  close = client.close;
  return client;
}

describe('CONFIRM_WRITES', () => {
  it('既定では確認しない', async () => {
    const client = await connect({});
    const res = await client.callTool('do_write', { what: 'x' });
    expect(res.json).toEqual({ done: 'x' });
    expect(client.serverRequests).toEqual([]);
  });

  it('有効なら Elicitation で確認し、承認されたら実行する', async () => {
    const client = await connect(
      { CONFIRM_WRITES: 'true' },
      { action: 'accept', content: { confirm: true } },
    );
    const res = await client.callTool('do_write', { what: 'x' });
    expect(res.isError).toBe(false);
    expect(res.json).toEqual({ done: 'x' });
    expect(executed).toBe(1);
    expect(client.serverRequests).toHaveLength(1);
    expect(JSON.stringify(client.serverRequests[0]?.params)).toContain('Really write x?');
  });

  it('拒否・キャンセルされたら実行しない', async () => {
    for (const answer of [
      { action: 'decline' },
      { action: 'cancel' },
      { action: 'accept', content: { confirm: false } },
    ]) {
      const client = await connect({ CONFIRM_WRITES: 'true' }, answer);
      const res = await client.callTool('do_write', { what: 'x' });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/cancel/i);
      await client.close();
    }
    expect(executed).toBe(0);
  });

  it('クライアントが Elicitation に対応していなければ実行しない', async () => {
    const client = await connect({ CONFIRM_WRITES: 'true' }, undefined, {});
    const res = await client.callTool('do_write', { what: 'x' });
    expect(res.isError).toBe(true);
    expect(executed).toBe(0);
  });

  it('読み取りツールは確認しない', async () => {
    const client = await connect({ CONFIRM_WRITES: 'true' });
    expect((await client.callTool('do_read')).json).toEqual({ ok: true });
    expect(client.serverRequests).toEqual([]);
  });
});
