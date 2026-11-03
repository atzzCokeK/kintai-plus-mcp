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
  inputSchema: z.object({ what: z.string(), confirm: z.boolean().optional() }),
  capability: 'profile',
  audience: 'everyone',
  kind: 'write',
  destructive: false,
  idempotent: false,
  handler: async (input, ctx) => {
    await ctx.confirm(`Really write ${input.what}?`);
    executed++;
    return { done: input.what };
  },
});
const deleteTool = defineTool({
  name: 'do_delete',
  title: 'Do delete',
  description: 'test',
  inputSchema: z.object({ what: z.string(), confirm: z.boolean().optional() }),
  capability: 'profile',
  audience: 'everyone',
  kind: 'write',
  destructive: true,
  idempotent: true,
  handler: async (input, ctx) => {
    await ctx.confirm(`Delete ${input.what}?`);
    executed++;
    return { deleted: input.what };
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

const FORM = { elicitation: { form: {} } };

async function connect(
  env: Record<string, string>,
  answer?: unknown,
  capabilities: Record<string, unknown> = FORM,
) {
  const server = createMcpServer(fakeContext(undefined, env), [writeTool, deleteTool, readTool]);
  const client = await connectTestClient(server, {
    capabilities,
    onServerRequest: (method) => (method === 'elicitation/create' ? answer : undefined),
  });
  close = client.close;
  return client;
}

describe('書き込み前の確認', () => {
  it('既定は削除だけ確認する。打刻相当の書き込みはダイアログなしで実行する', async () => {
    const client = await connect({});
    const res = await client.callTool('do_write', { what: 'x' });
    expect(res.json).toEqual({ done: 'x' });
    expect(res.structuredContent).toEqual({ done: 'x' });
    expect(client.serverRequests).toEqual([]);
    expect(executed).toBe(1);
  });

  it('既定では削除を elicitation/create で確認し、承認されたら実行する', async () => {
    const client = await connect({}, { action: 'accept', content: { confirm: true } });
    const res = await client.callTool('do_delete', { what: 'row' });
    expect(res.isError).toBe(false);
    expect(res.json).toEqual({ deleted: 'row' });
    expect(executed).toBe(1);
    expect(client.serverRequests).toHaveLength(1);
    expect(client.serverRequests[0]?.method).toBe('elicitation/create');
    expect(JSON.stringify(client.serverRequests[0]?.params)).toContain('Delete row?');
  });

  it('always は削除でない書き込みも確認する', async () => {
    const client = await connect(
      { KINTAI_PLUS_CONFIRM: 'always' },
      { action: 'accept', content: { confirm: true } },
    );
    const res = await client.callTool('do_write', { what: 'x' });
    expect(res.json).toEqual({ done: 'x' });
    expect(client.serverRequests).toHaveLength(1);
    expect(JSON.stringify(client.serverRequests[0]?.params)).toContain('Really write x?');
  });

  it('never は削除も確認しない', async () => {
    const client = await connect({ KINTAI_PLUS_CONFIRM: 'never' });
    expect((await client.callTool('do_delete', { what: 'row' })).json).toEqual({ deleted: 'row' });
    expect(client.serverRequests).toEqual([]);
  });

  it('環境変数は旧名より優先する（always ではなく destructive）', async () => {
    const client = await connect({
      KINTAI_PLUS_CONFIRM: 'destructive',
      KINTAI_PLUS_CONFIRM_WRITES: 'true',
    });
    expect((await client.callTool('do_write', { what: 'x' })).json).toEqual({ done: 'x' });
    expect(client.serverRequests).toEqual([]);
  });

  it('旧名 KINTAI_PLUS_CONFIRM_WRITES=true は毎回確認になる', async () => {
    const client = await connect(
      { KINTAI_PLUS_CONFIRM_WRITES: 'true' },
      { action: 'accept', content: { confirm: true } },
    );
    expect((await client.callTool('do_write', { what: 'x' })).json).toEqual({ done: 'x' });
    expect(client.serverRequests).toHaveLength(1);
  });

  it('decline と cancel、確認チェックを外した accept では実行しない', async () => {
    for (const answer of [
      { action: 'decline' },
      { action: 'cancel' },
      { action: 'accept', content: { confirm: false } },
    ]) {
      const client = await connect({ KINTAI_PLUS_CONFIRM: 'always' }, answer);
      const res = await client.callTool('do_write', { what: 'x' });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/cancel/i);
      await client.close();
    }
    expect(executed).toBe(0);
  });

  it('ダイアログ対応でも decline なら confirm: true だけでは実行しない', async () => {
    const client = await connect({ KINTAI_PLUS_CONFIRM: 'always' }, { action: 'decline' });
    const res = await client.callTool('do_write', { what: 'x', confirm: true });
    expect(res.isError).toBe(true);
    expect(executed).toBe(0);
  });

  it('elicitation: {} も form 対応としてダイアログを出す', async () => {
    const client = await connect(
      { KINTAI_PLUS_CONFIRM: 'always' },
      { action: 'accept', content: { confirm: true } },
      { elicitation: {} },
    );
    expect((await client.callTool('do_write', { what: 'x' })).json).toEqual({ done: 'x' });
    expect(client.serverRequests[0]?.method).toBe('elicitation/create');
  });

  it('url だけの elicitation はダイアログにせず、confirm: true まで実行しない', async () => {
    const client = await connect({}, undefined, { elicitation: { url: {} } });
    const preview = await client.callTool('do_delete', { what: 'row' });
    expect(preview.isError).toBe(false);
    expect(preview.json).toMatchObject({ executed: false });
    expect(preview.structuredContent).toMatchObject({
      executed: false,
      preview: 'Delete row?',
    });
    expect(preview.text).toContain('confirm: true');
    expect(executed).toBe(0);
    expect(client.serverRequests).toEqual([]);
    const applied = await client.callTool('do_delete', { what: 'row', confirm: true });
    expect(applied.json).toEqual({ deleted: 'row' });
    expect(executed).toBe(1);
  });

  it('未対応クライアントはプレビューを返し、confirm: true で再実行すると書く', async () => {
    const client = await connect({ KINTAI_PLUS_CONFIRM: 'always' }, undefined, {});
    const preview = await client.callTool('do_write', { what: 'x' });
    expect(preview.isError).toBe(false);
    expect(preview.json).toMatchObject({ executed: false, preview: 'Really write x?' });
    expect(preview.text).toMatch(/confirm: true/);
    expect(executed).toBe(0);
    const applied = await client.callTool('do_write', { what: 'x', confirm: true });
    expect(applied.json).toEqual({ done: 'x' });
    expect(executed).toBe(1);
  });

  it('読み取りツールは確認しない', async () => {
    const client = await connect({ KINTAI_PLUS_CONFIRM: 'always' });
    expect((await client.callTool('do_read')).json).toEqual({ ok: true });
    expect(client.serverRequests).toEqual([]);
  });
});
