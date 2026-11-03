import { describe, expect, it } from 'vitest';
import type { Alert } from '../../src/api/alerts.ts';
import { KintaiApiError } from '../../src/api/errors.ts';
import type { ManhourDay } from '../../src/api/manhours.ts';
import type { DateRange } from '../../src/api/paging.ts';
import { STAMP_TYPE_CODES, type Stamp, type StampType } from '../../src/api/stamps.ts';
import type { WorkingRecord } from '../../src/api/working-records.ts';
import { createMcpServer } from '../../src/server/create-server.ts';
import { closeOutTool } from '../../src/tools/close-out.ts';
import { ToolInputError } from '../../src/tools/result.ts';
import { fakeBackend, fakeContext } from '../helpers/fake-backend.ts';
import { connectTestClient } from '../helpers/mcp-client.ts';

const s = (type: StampType, iso: string): Stamp => ({
  type,
  typeCode: STAMP_TYPE_CODES[type],
  stampedAt: new Date(iso),
  attributes: {},
});

interface Seen {
  stamps: DateRange[];
  records: DateRange[];
  manhours: DateRange[];
  alerts: number;
}

function backend(
  seen: Seen,
  data?: {
    stamps?: Stamp[];
    records?: WorkingRecord[];
    manhours?: ManhourDay[];
    alerts?: Alert[];
    failManhours?: boolean;
  },
) {
  return fakeBackend({
    getStamps: async (range) => {
      seen.stamps.push(range);
      return { stamps: data?.stamps ?? [], truncated: false };
    },
    getWorkingRecords: async (range) => {
      seen.records.push(range);
      return data?.records ?? [];
    },
    getManhours: async (range) => {
      seen.manhours.push(range);
      if (data?.failManhours) {
        throw new KintaiApiError({ kind: 'forbidden', message: 'no manhours permission' });
      }
      return data?.manhours ?? [];
    },
    getAlerts: async () => {
      seen.alerts += 1;
      return data?.alerts ?? [];
    },
  });
}

describe('close_out', () => {
  it('読み取り専用で、1 日の既定は日本時間の今日。API は 4 種を 1 回ずつ', async () => {
    expect(closeOutTool.kind).toBe('read');
    expect(closeOutTool.audience).toBe('everyone');
    const seen: Seen = { stamps: [], records: [], manhours: [], alerts: 0 };
    const out = await closeOutTool.handler(
      {},
      fakeContext(backend(seen), {}, new Date('2026-10-27T01:00:00Z')),
    );
    expect(seen.stamps).toEqual([{ from: '2026-10-26', to: '2026-10-27' }]);
    expect(seen.records).toEqual([{ from: '2026-10-01', to: '2026-10-27' }]);
    expect(seen.manhours).toEqual([{ from: '2026-10-27', to: '2026-10-27' }]);
    expect(seen.alerts).toBe(1);
    expect(out).toMatchObject({
      scope: 'day',
      date: '2026-10-27',
      month: '2026-10',
      from: '2026-10-27',
      to: '2026-10-27',
    });
  });

  it('日本時間で日付が変わると、既定の日と月が翌月になる', async () => {
    const seen: Seen = { stamps: [], records: [], manhours: [], alerts: 0 };
    const out = await closeOutTool.handler(
      {},
      fakeContext(backend(seen), {}, new Date('2026-10-31T15:30:00Z')),
    );
    expect(out).toMatchObject({ scope: 'day', date: '2026-11-01', month: '2026-11' });
    expect(seen.stamps).toEqual([{ from: '2026-10-31', to: '2026-11-01' }]);
    expect(seen.records).toEqual([{ from: '2026-11-01', to: '2026-11-01' }]);
    expect(seen.manhours).toEqual([{ from: '2026-11-01', to: '2026-11-01' }]);
  });

  it('月の指定は前月を月末まで取り、当日の進行中は混ぜない', async () => {
    const seen: Seen = { stamps: [], records: [], manhours: [], alerts: 0 };
    const out = await closeOutTool.handler(
      { scope: 'month', month: '2026-10' },
      fakeContext(
        backend(seen, {
          stamps: [s('clock_in', '2026-10-31T08:00:00+09:00')],
          records: [{ date: '2026-10-31', dayCategory: 'workday' }],
        }),
        {},
        new Date('2026-11-01T00:30:00+09:00'),
      ),
    );
    expect(seen.records).toEqual([{ from: '2026-10-01', to: '2026-10-31' }]);
    expect(seen.stamps).toEqual([{ from: '2026-09-30', to: '2026-11-01' }]);
    expect(seen.manhours).toEqual([{ from: '2026-10-01', to: '2026-10-31' }]);
    expect(out).toMatchObject({
      scope: 'month',
      month: '2026-10',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    const items = (out as { items: Array<{ code: string; date?: string; action: string }> }).items;
    const missing = items.find((i) => i.date === '2026-10-31' && i.code === 'missing_clock_out');
    expect(missing?.action).toMatch(/修正申請/);
  });

  it('未来の日・スコープと食い違う引数は API を呼ばずに拒む', async () => {
    const seen: Seen = { stamps: [], records: [], manhours: [], alerts: 0 };
    const ctx = fakeContext(backend(seen), {}, new Date('2026-10-27T01:00:00Z'));
    await expect(closeOutTool.handler({ date: '2026-12-01' }, ctx)).rejects.toThrow(ToolInputError);
    await expect(closeOutTool.handler({ scope: 'day', month: '2026-10' }, ctx)).rejects.toThrow(
      ToolInputError,
    );
    await expect(closeOutTool.handler({ scope: 'month', date: '2026-10-01' }, ctx)).rejects.toThrow(
      ToolInputError,
    );
    await expect(closeOutTool.handler({ scope: 'month', month: '2026-13' }, ctx)).rejects.toThrow(
      /01-12/,
    );
    expect(seen.alerts).toBe(0);
    expect(seen.stamps).toEqual([]);
  });

  it('工数が取れなくても打刻の問題は返し、失敗を項目にする', async () => {
    const seen: Seen = { stamps: [], records: [], manhours: [], alerts: 0 };
    const out = (await closeOutTool.handler(
      { date: '2026-10-26' },
      fakeContext(
        backend(seen, {
          failManhours: true,
          stamps: [
            s('clock_in', '2026-10-26T09:00:00+09:00'),
            s('clock_out', '2026-10-26T18:00:00+09:00'),
          ],
        }),
        {},
        new Date('2026-10-27T01:00:00Z'),
      ),
    )) as { items: Array<{ code: string }>; ok: boolean };
    expect(out.items.map((i) => i.code)).toContain('no_break_punches');
    expect(out.items.map((i) => i.code)).toContain('incomplete_data');
    expect(out.ok).toBe(false);
  });

  it('入力エラーは isError で、成功形の structuredContent を付けない', async () => {
    const server = createMcpServer(fakeContext(fakeBackend()), [closeOutTool]);
    const client = await connectTestClient(server);
    try {
      const res = await client.callTool('close_out', { scope: 'day', month: '2026-10' });
      expect(res.isError).toBe(true);
      expect(res.structuredContent).toBeUndefined();
      expect(res.text).toMatch(/month/);
    } finally {
      await client.close();
    }
  });

  it('MCP の outputSchema と structuredContent で同じ結果を返す', async () => {
    const seen: Seen = { stamps: [], records: [], manhours: [], alerts: 0 };
    const server = createMcpServer(
      fakeContext(
        backend(seen, {
          stamps: [
            s('clock_in', '2026-10-27T09:00:00+09:00'),
            s('break_start', '2026-10-27T12:00:00+09:00'),
            s('break_end', '2026-10-27T13:00:00+09:00'),
            s('clock_out', '2026-10-27T18:00:00+09:00'),
          ],
          manhours: [
            {
              date: '2026-10-27',
              closed: false,
              fixed: false,
              totalMinutes: 480,
              projects: [{ projectId: 1, totalMinutes: 480, items: [{ taskId: 1, minutes: 480 }] }],
            },
          ],
          records: [{ date: '2026-10-27', dayCategory: 'workday', actualWorkingMinutes: 480 }],
        }),
        {},
        new Date('2026-10-27T10:00:00Z'),
      ),
      [closeOutTool],
    );
    const client = await connectTestClient(server);
    try {
      const tools = await client.listTools();
      expect(tools[0]?.name).toBe('close_out');
      expect(tools[0]?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tools[0]?.outputSchema).toMatchObject({ type: 'object' });
      const res = await client.callTool('close_out', { scope: 'day' });
      expect(res.isError).toBe(false);
      expect(res.json).toMatchObject({ ok: true, readyToClose: true, items: [] });
      expect(res.json).toMatchObject({ headline: expect.stringMatching(/対応は不要/) });
    } finally {
      await client.close();
    }
  });
});
