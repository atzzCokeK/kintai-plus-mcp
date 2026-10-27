import { describe, expect, it } from 'vitest';
import { STAMP_TYPE_CODES, type Stamp, type StampType } from '../../src/api/stamps.ts';
import type { PunchInput } from '../../src/backend/types.ts';
import { punchTool } from '../../src/tools/punch.ts';
import { ToolInputError, ToolRefusedError } from '../../src/tools/result.ts';
import { fakeBackend, fakeContext } from '../helpers/fake-backend.ts';

const NOW = new Date('2026-10-27T01:00:00Z'); // 10:00 JST
const s = (type: StampType, iso: string): Stamp => ({
  type,
  typeCode: STAMP_TYPE_CODES[type],
  stampedAt: new Date(iso),
  attributes: {},
});

function setup(today: Stamp[]) {
  const punched: PunchInput[] = [];
  const backend = fakeBackend({
    getStamps: async () => ({ stamps: today, truncated: false }),
    punch: async (input) => {
      punched.push(input);
      return { stampedAt: new Date('2026-10-27T01:00:02Z') };
    },
  });
  return { ctx: fakeContext(backend, {}, NOW), punched };
}

describe('punch', () => {
  it('矛盾がなければ打刻し、記録時刻と新しい状態を返す', async () => {
    const { ctx, punched } = setup([]);
    const out = await punchTool.handler({ type: 'clock_in' }, ctx);
    expect(punched).toEqual([{ type: 'clock_in', at: NOW }]);
    expect(out).toMatchObject({
      punched: 'clock_in',
      typeLabel: '出勤',
      stampedAt: '2026-10-27T10:00:02+09:00',
      previousState: 'not_started',
      newState: 'working',
    });
    expect(JSON.stringify(out)).toMatch(/cannot be edited/i);
  });

  it('その日の打刻と矛盾すれば打刻せず、理由と force の案内を返す', async () => {
    const { ctx, punched } = setup([s('clock_in', '2026-10-27T09:00:00+09:00')]);
    const err = await punchTool.handler({ type: 'clock_in' }, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolRefusedError);
    expect((err as ToolRefusedError).message).toMatch(/already clocked in/i);
    expect((err as ToolRefusedError).hint).toMatch(/force/);
    expect(punched).toEqual([]);
  });

  it('force: true なら矛盾していても打刻する', async () => {
    const { ctx, punched } = setup([s('clock_in', '2026-10-27T09:00:00+09:00')]);
    const out = await punchTool.handler({ type: 'clock_in', force: true }, ctx);
    expect(punched).toHaveLength(1);
    expect(out).toMatchObject({ forced: true });
  });

  it('テレワークは出勤（clock_in）のときだけ指定できる', async () => {
    const { ctx, punched } = setup([]);
    await punchTool.handler({ type: 'clock_in', telework: true }, ctx);
    expect(punched[0]).toMatchObject({ telework: true });
    const working = setup([s('clock_in', '2026-10-27T09:00:00+09:00')]);
    await expect(
      punchTool.handler({ type: 'clock_out', telework: true }, working.ctx),
    ).rejects.toThrow(ToolInputError);
  });

  it('書き込みツールとして申告する', () => {
    expect(punchTool.kind).toBe('write');
    expect(punchTool.capability).toBe('stamps.write');
  });
});
