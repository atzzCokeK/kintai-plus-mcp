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

  it('未出勤の退勤は記録しない', async () => {
    const { ctx, punched } = setup([]);
    const err = await punchTool.handler({ type: 'clock_out' }, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolRefusedError);
    expect((err as ToolRefusedError).details).toMatchObject({
      state: 'not_started',
      lastPunch: null,
    });
    expect(punched).toEqual([]);
  });

  it('休憩中の退勤は記録せず、休憩戻を案内する', async () => {
    const { ctx, punched } = setup([
      s('clock_in', '2026-10-27T09:00:00+09:00'),
      s('break_start', '2026-10-27T09:30:00+09:00'),
    ]);
    const err = await punchTool.handler({ type: 'clock_out' }, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolRefusedError);
    expect((err as ToolRefusedError).message).toMatch(/on a break/i);
    expect(punched).toEqual([]);
  });

  it('休憩入で休憩中になり、休憩戻で勤務中に戻る', async () => {
    const started = setup([s('clock_in', '2026-10-27T09:00:00+09:00')]);
    expect(await punchTool.handler({ type: 'break_start' }, started.ctx)).toMatchObject({
      previousState: 'working',
      newState: 'on_break',
    });
    const onBreak = setup([
      s('clock_in', '2026-10-27T09:00:00+09:00'),
      s('break_start', '2026-10-27T09:30:00+09:00'),
    ]);
    expect(await punchTool.handler({ type: 'break_end' }, onBreak.ctx)).toMatchObject({
      previousState: 'on_break',
      newState: 'working',
    });
    expect(onBreak.punched).toEqual([{ type: 'break_end', at: NOW }]);
  });

  it('退勤済みの再出勤は force が無いと記録しない', async () => {
    const stamps = [
      s('clock_in', '2026-10-27T09:00:00+09:00'),
      s('clock_out', '2026-10-27T09:30:00+09:00'),
    ];
    const refused = setup(stamps);
    await expect(punchTool.handler({ type: 'clock_in' }, refused.ctx)).rejects.toBeInstanceOf(
      ToolRefusedError,
    );
    expect(refused.punched).toEqual([]);
    const forced = setup(stamps);
    expect(await punchTool.handler({ type: 'clock_in', force: true }, forced.ctx)).toMatchObject({
      previousState: 'finished',
      newState: 'working',
      forced: true,
    });
    expect(forced.punched).toHaveLength(1);
  });

  it('書き込みツールとして申告する', () => {
    expect(punchTool.kind).toBe('write');
    expect(punchTool.capability).toBe('stamps.write');
  });
});
