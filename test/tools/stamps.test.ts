import { describe, expect, it } from 'vitest';
import type { DateRange } from '../../src/api/paging.ts';
import { STAMP_TYPE_CODES, type Stamp, type StampType } from '../../src/api/stamps.ts';
import { ToolInputError } from '../../src/tools/result.ts';
import { getStampsTool, getTodayStatusTool } from '../../src/tools/stamps.ts';
import { fakeBackend, fakeContext } from '../helpers/fake-backend.ts';

const s = (type: StampType, iso: string, attributes: Record<string, unknown> = {}): Stamp => ({
  type,
  typeCode: STAMP_TYPE_CODES[type],
  stampedAt: new Date(iso),
  attributes,
});

function backendWith(stamps: Stamp[], seen: DateRange[] = [], truncated = false) {
  return fakeBackend({
    getStamps: async (range) => {
      seen.push(range);
      return { stamps, truncated };
    },
  });
}

// テストの「今」は 2026-10-27 10:00 JST
const NOW = new Date('2026-10-27T01:00:00Z');

describe('get_stamps', () => {
  it('期間を省略したら今日。位置情報・IP は既定で除く', async () => {
    const seen: DateRange[] = [];
    const backend = backendWith(
      [
        s('clock_in', '2026-10-27T09:00:00+09:00', {
          method: 1,
          latitude: 35,
          longitude: 139,
          ip: '192.0.2.1',
        }),
      ],
      seen,
    );
    const out = await getStampsTool.handler({}, fakeContext(backend, {}, NOW));
    expect(seen).toEqual([{ from: '2026-10-27', to: '2026-10-27' }]);
    expect(out).toEqual({
      from: '2026-10-27',
      to: '2026-10-27',
      count: 1,
      stamps: [
        {
          stampedAt: '2026-10-27T09:00:00+09:00',
          type: 'clock_in',
          typeLabel: '出勤',
          attributes: { method: 1 },
        },
      ],
    });
  });

  it('KINTAI_PLUS_INCLUDE_LOCATION=true なら位置情報も返す', async () => {
    const backend = backendWith([s('clock_in', '2026-10-27T09:00:00+09:00', { latitude: 35 })]);
    const out = (await getStampsTool.handler(
      {},
      fakeContext(backend, { KINTAI_PLUS_INCLUDE_LOCATION: 'true' }, NOW),
    )) as { stamps: Array<{ attributes: unknown }> };
    expect(out.stamps[0]?.attributes).toEqual({ latitude: 35 });
  });

  it('to だけ省略したら from と同じ日', async () => {
    const seen: DateRange[] = [];
    await getStampsTool.handler(
      { from: '2026-10-01' },
      fakeContext(backendWith([], seen), {}, NOW),
    );
    expect(seen).toEqual([{ from: '2026-10-01', to: '2026-10-01' }]);
  });

  it('取りきれなかったら truncated と注意を返す', async () => {
    const out = await getStampsTool.handler(
      { from: '2026-10-01', to: '2026-10-27' },
      fakeContext(backendWith([], [], true), {}, NOW),
    );
    expect(out).toMatchObject({ truncated: true });
    expect(JSON.stringify(out)).toMatch(/shorter period/);
  });

  it('不正な期間は ToolInputError', async () => {
    const ctx = fakeContext(backendWith([]), {}, NOW);
    await expect(
      getStampsTool.handler({ from: '2026-10-05', to: '2026-10-01' }, ctx),
    ).rejects.toThrow(ToolInputError);
    await expect(getStampsTool.handler({ from: '2026-02-30' }, ctx)).rejects.toThrow(
      ToolInputError,
    );
    await expect(
      getStampsTool.handler({ from: '2024-01-01', to: '2026-10-01' }, ctx),
    ).rejects.toThrow(/366/);
  });
});

describe('get_today_status', () => {
  it('今日の打刻から、勤務中・ここまでの勤務時間を返す', async () => {
    const seen: DateRange[] = [];
    const backend = backendWith(
      [s('clock_in', '2026-10-27T08:30:00+09:00'), s('break_start', '2026-10-27T09:30:00+09:00')],
      seen,
    );
    const out = await getTodayStatusTool.handler({}, fakeContext(backend, {}, NOW));
    expect(seen).toEqual([{ from: '2026-10-27', to: '2026-10-27' }]);
    expect(out).toEqual({
      date: '2026-10-27',
      now: '2026-10-27T10:00:00+09:00',
      state: 'on_break',
      stateLabel: '休憩中',
      workedMinutes: 60,
      workedHours: '1:00',
      breakMinutes: 30,
      firstClockInAt: '2026-10-27T08:30:00+09:00',
      stamps: [
        { stampedAt: '2026-10-27T08:30:00+09:00', type: 'clock_in', typeLabel: '出勤' },
        { stampedAt: '2026-10-27T09:30:00+09:00', type: 'break_start', typeLabel: '休憩入' },
      ],
    });
  });

  it('打刻がなければ未出勤', async () => {
    const out = await getTodayStatusTool.handler({}, fakeContext(backendWith([]), {}, NOW));
    expect(out).toMatchObject({ state: 'not_started', stateLabel: '未出勤', workedMinutes: 0 });
  });
});
