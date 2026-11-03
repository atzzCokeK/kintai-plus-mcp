import { afterEach, describe, expect, it } from 'vitest';
import { NotLoggedInError } from '../../src/credentials/token-manager.ts';
import { attendanceGuide } from '../../src/domain/guide.ts';
import { createMcpServer } from '../../src/server/create-server.ts';
import { ALL_TOOLS } from '../../src/tools/index.ts';
import { annotationsFor } from '../../src/tools/registry.ts';
import { getTodayStatusTool } from '../../src/tools/stamps.ts';
import { fakeBackend, fakeContext } from '../helpers/fake-backend.ts';
import { connectTestClient } from '../helpers/mcp-client.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

describe('ツール注釈を MCP に公開する', () => {
  it('登録した全ツールの annotations が title と 4 つの hint を持つ', async () => {
    const client = await connectTestClient(createMcpServer(fakeContext(), ALL_TOOLS));
    close = client.close;
    const listed = await client.listTools();
    expect(listed.map((tool) => tool.name)).toEqual(ALL_TOOLS.map((tool) => tool.name));
    for (const listedTool of listed) {
      const defined = ALL_TOOLS.find((tool) => tool.name === listedTool.name);
      expect(listedTool.annotations, String(listedTool.name)).toEqual(
        annotationsFor(defined as never),
      );
    }
    const punch = listed.find((tool) => tool.name === 'punch')?.annotations as {
      destructiveHint: boolean;
    };
    const remove = listed.find((tool) => tool.name === 'delete_manhours')?.annotations as {
      destructiveHint: boolean;
    };
    expect(punch.destructiveHint).toBe(false);
    expect(remove.destructiveHint).toBe(true);
  });
});

describe('kintai:// リソース', () => {
  it('今日・今月の締め・就業ルールを一覧し、ツールと同じ内容を読む', async () => {
    const now = new Date('2026-10-27T01:00:00Z');
    const backend = fakeBackend({
      getStamps: async () => ({ stamps: [], truncated: false }),
      getWorkingRecords: async () => [],
      getManhours: async () => [],
      getAlerts: async () => [],
    });
    const ctx = fakeContext(backend, {}, now);
    const client = await connectTestClient(createMcpServer(ctx, ALL_TOOLS));
    close = client.close;
    const resources = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual([
      'kintai://today',
      'kintai://close-out/month',
      'kintai://guide',
    ]);
    expect(
      (client.init.result as { capabilities: { resources?: { listChanged?: boolean } } })
        .capabilities.resources?.listChanged,
    ).toBe(true);

    const today = await client.readResource('kintai://today');
    expect(today.contents[0]).toMatchObject({ mimeType: 'application/json' });
    expect(today.json).toEqual(await getTodayStatusTool.handler({}, ctx));

    const month = await client.readResource('kintai://close-out/month');
    expect(month.json).toMatchObject({ scope: 'month', month: '2026-10', timezone: 'Asia/Tokyo' });

    const guide = await client.readResource('kintai://guide');
    expect(guide.json).toEqual(attendanceGuide());
    const viaTool = await client.callTool('get_attendance_guide');
    expect(viaTool.json).toEqual(guide.json);
    expect(viaTool.structuredContent).toEqual(guide.json);
    expect(JSON.parse(viaTool.text)).toEqual(viaTool.structuredContent);
  });

  it('今日の取得に失敗しても、リソースの本文はトークンを含まない案内になる', async () => {
    const backend = fakeBackend({
      getStamps: async () => {
        throw new NotLoggedInError();
      },
    });
    const client = await connectTestClient(
      createMcpServer(fakeContext(backend), [getTodayStatusTool]),
    );
    close = client.close;
    const resources = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual(['kintai://today']);
    const today = await client.readResource('kintai://today');
    expect(today.contents[0]?.mimeType).toBe('text/plain');
    expect(today.text).toMatch(/login/);
    expect(today.text).not.toMatch(/token=/i);
  });

  it('対応するツールが無ければリソースも出さない', async () => {
    const client = await connectTestClient(createMcpServer(fakeContext(), []));
    close = client.close;
    expect(
      (client.init.result as { capabilities: { resources?: unknown } }).capabilities.resources,
    ).toBeUndefined();
    const listed = await client.request('resources/list');
    expect(listed.error).toBeTruthy();
  });
});
