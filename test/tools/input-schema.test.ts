import { describe, expect, it } from 'vitest';
import { createMcpServer } from '../../src/server/create-server.ts';
import { getAlertsTool } from '../../src/tools/alerts.ts';
import { ALL_TOOLS } from '../../src/tools/index.ts';
import { saveManhoursTool } from '../../src/tools/manhours-write.ts';
import { fakeContext } from '../helpers/fake-backend.ts';
import { connectTestClient } from '../helpers/mcp-client.ts';

const VALID: Record<string, unknown> = {
  punch: { type: 'clock_in' },
  save_manhours: {
    date: '2026-10-01',
    entries: [{ projectId: 1, taskId: 1, minutes: 30 }],
  },
  delete_manhours: { date: '2026-10-01', projectId: 1 },
  list_tasks: { projectId: 1 },
  get_project_members: { projectId: 1 },
};

describe('tool input schemas', () => {
  it('未知の引数を拒否する', () => {
    for (const tool of ALL_TOOLS) {
      const base = VALID[tool.name] ?? {};
      expect(tool.inputSchema.safeParse(base).success, `${tool.name} valid`).toBe(true);
      expect(
        tool.inputSchema.safeParse({ ...base, includeOk: true }).success,
        `${tool.name} unknown`,
      ).toBe(false);
    }
  });

  it('工数の内訳にある未知の項目も拒否する', () => {
    const parsed = saveManhoursTool.inputSchema.safeParse({
      date: '2026-10-01',
      entries: [{ projectId: 1, taskId: 1, minutes: 30, note: 'x' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('呼び出し時にも未知の引数はエラーになり、公開スキーマは追加プロパティを拒む', async () => {
    const client = await connectTestClient(createMcpServer(fakeContext(), [getAlertsTool]));
    try {
      const tools = await client.listTools();
      expect(tools[0]?.inputSchema).toMatchObject({ additionalProperties: false });
      const res = await client.callTool('get_alerts', { month: '2026-10', includeOk: true });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/includeOk/);
      const month = await client.callTool('get_alerts', { month: '2026-13' });
      expect(month.isError).toBe(true);
      expect(month.text).toMatch(/01-12/);
    } finally {
      await client.close();
    }
  });
});
