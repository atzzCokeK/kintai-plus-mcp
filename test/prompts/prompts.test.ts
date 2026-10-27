import { afterEach, describe, expect, it } from 'vitest';
import { ALL_PROMPTS, selectPrompts } from '../../src/prompts/index.ts';
import { createMcpServer } from '../../src/server/create-server.ts';
import { ALL_TOOLS } from '../../src/tools/index.ts';
import { fakeContext } from '../helpers/fake-backend.ts';
import { connectTestClient } from '../helpers/mcp-client.ts';

const names = (xs: readonly { name: string }[]) => xs.map((x) => x.name);
const allToolNames = new Set(ALL_TOOLS.map((t) => t.name));

describe('selectPrompts', () => {
  it('必要なツールがすべて公開されているプロンプトだけを出す', () => {
    expect(names(selectPrompts(ALL_PROMPTS, allToolNames))).toEqual([
      'end_of_day',
      'log_manhours',
      'monthly_review',
      'team_status',
    ]);
    const employeeReadOnly = new Set(
      ALL_TOOLS.filter((t) => t.audience === 'everyone' && t.kind === 'read').map((t) => t.name),
    );
    expect(names(selectPrompts(ALL_PROMPTS, employeeReadOnly))).toEqual(['monthly_review']);
  });

  it('プロンプトが使うツールはすべて実在する', () => {
    for (const p of ALL_PROMPTS) for (const t of p.requiredTools) expect(allToolNames).toContain(t);
  });
});

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

describe('MCP Prompts', () => {
  it('prompts/list と prompts/get に応答する（引数で日付・月を渡せる）', async () => {
    const ctx = fakeContext(undefined, {}, new Date('2026-10-27T09:00:00Z'));
    const server = createMcpServer(ctx, ALL_TOOLS, {}, ALL_PROMPTS);
    const client = await connectTestClient(server);
    close = client.close;
    const list = (await client.request('prompts/list')).result as {
      prompts: Array<{ name: string }>;
    };
    expect(names(list.prompts)).toContain('end_of_day');

    const got = (
      await client.request('prompts/get', {
        name: 'log_manhours',
        arguments: { date: '2026-10-26' },
      })
    ).result as { messages: Array<{ role: string; content: { type: string; text: string } }> };
    expect(got.messages[0]?.role).toBe('user');
    const text = got.messages[0]?.content.text ?? '';
    expect(text).toContain('2026-10-26');
    expect(text).toContain('save_manhours');

    const review = (await client.request('prompts/get', { name: 'monthly_review', arguments: {} }))
      .result as {
      messages: Array<{ content: { text: string } }>;
    };
    expect(review.messages[0]?.content.text).toContain('2026-10');
  });
});
