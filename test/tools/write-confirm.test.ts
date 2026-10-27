import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '../../src/tools/index.ts';
import { deleteManhoursTool, saveManhoursTool } from '../../src/tools/manhours-write.ts';
import { punchTool } from '../../src/tools/punch.ts';
import { fakeBackend, fakeContext } from '../helpers/fake-backend.ts';

class Stop extends Error {}

/** confirm で止めて、書き込みが呼ばれていないこと・確認メッセージを確かめる */
function setup() {
  const writes: string[] = [];
  const messages: string[] = [];
  const backend = fakeBackend({
    getStamps: async () => ({ stamps: [], truncated: false }),
    punch: async () => {
      writes.push('punch');
      return {};
    },
    getManhours: async () => [
      {
        date: '2026-10-27',
        closed: false,
        fixed: false,
        totalMinutes: 60,
        projects: [{ projectId: 3, totalMinutes: 60, items: [{ taskId: 10, minutes: 60 }] }],
      },
    ],
    listTasks: async () => ({
      tasks: [{ taskId: 10, name: '設計', finished: false }],
      truncated: false,
    }),
    listProjects: async () => ({
      projects: [{ projectId: 3, name: '社内基盤' }],
      truncated: false,
    }),
    saveManhours: async () => {
      writes.push('save');
    },
    deleteManhours: async () => {
      writes.push('delete');
    },
  });
  const ctx = {
    ...fakeContext(backend),
    confirm: async (message: string) => {
      messages.push(message);
      throw new Stop();
    },
  };
  return { ctx, writes, messages };
}

describe('書き込みツールは書き込みの前に確認する', () => {
  it('punch', async () => {
    const { ctx, writes, messages } = setup();
    await expect(punchTool.handler({ type: 'clock_in', telework: true }, ctx)).rejects.toThrow(
      Stop,
    );
    expect(writes).toEqual([]);
    expect(messages[0]).toMatch(/出勤/);
    expect(messages[0]).toMatch(/テレワーク/);
  });

  it('save_manhours', async () => {
    const { ctx, writes, messages } = setup();
    await expect(
      saveManhoursTool.handler(
        { date: '2026-10-27', entries: [{ projectId: 3, taskId: 10, minutes: 90 }] },
        ctx,
      ),
    ).rejects.toThrow(Stop);
    expect(writes).toEqual([]);
    expect(messages[0]).toMatch(/2026-10-27/);
    expect(messages[0]).toMatch(/1:30/);
  });

  it('delete_manhours', async () => {
    const { ctx, writes, messages } = setup();
    await expect(
      deleteManhoursTool.handler({ date: '2026-10-27', projectId: 3 }, ctx),
    ).rejects.toThrow(Stop);
    expect(writes).toEqual([]);
    expect(messages[0]).toMatch(/delete/i);
  });

  it('書き込みツールはこの 3 つだけ（増やしたら確認のテストも足す）', () => {
    expect(
      ALL_TOOLS.filter((t) => t.kind === 'write')
        .map((t) => t.name)
        .sort(),
    ).toEqual(['delete_manhours', 'punch', 'save_manhours']);
  });
});
