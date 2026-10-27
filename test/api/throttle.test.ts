import { describe, expect, it } from 'vitest';
import { RequestThrottle } from '../../src/api/throttle.ts';

/** sleep すると時間が進むだけの偽の時計 */
function fakeClock() {
  let now = 1_000;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('RequestThrottle', () => {
  it('同時に投げても 1 件ずつ順番に実行する', async () => {
    const clock = fakeClock();
    const throttle = new RequestThrottle({ minIntervalMs: 0, clock });
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`start ${name}`);
      await Promise.resolve();
      await Promise.resolve();
      log.push(`end ${name}`);
      return name;
    };
    const results = await Promise.all([
      throttle.run(task('a')),
      throttle.run(task('b')),
      throttle.run(task('c')),
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('前のリクエストの開始から最小間隔をあける', async () => {
    const clock = fakeClock();
    const throttle = new RequestThrottle({ minIntervalMs: 250, clock });
    const starts: number[] = [];
    const task = async () => {
      starts.push(clock.now());
      clock.advance(50); // 処理に 50ms かかったことにする
    };
    await Promise.all([throttle.run(task), throttle.run(task), throttle.run(task)]);
    expect(starts).toEqual([1_000, 1_250, 1_500]);
  });

  it('十分時間が空いていれば待たない', async () => {
    const clock = fakeClock();
    const throttle = new RequestThrottle({ minIntervalMs: 250, clock });
    const starts: number[] = [];
    await throttle.run(async () => starts.push(clock.now()));
    clock.advance(1_000);
    await throttle.run(async () => starts.push(clock.now()));
    expect(starts).toEqual([1_000, 2_000]);
  });

  it('失敗しても後続のリクエストは実行される', async () => {
    const clock = fakeClock();
    const throttle = new RequestThrottle({ minIntervalMs: 10, clock });
    const failing = throttle.run(async () => {
      throw new Error('boom');
    });
    const ok = throttle.run(async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    await expect(ok).resolves.toBe('ok');
  });
});
