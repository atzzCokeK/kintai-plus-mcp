import { setTimeout as delay } from 'node:timers/promises';

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => delay(ms),
};

export interface RequestThrottleOptions {
  /** 前のリクエストの開始から次の開始までの最小間隔（ミリ秒） */
  minIntervalMs: number;
  clock?: Clock;
}

/** レート制限の記載がない API に配慮して、リクエストを 1 件ずつ・間隔をあけて実行する。 */
export class RequestThrottle {
  readonly #minIntervalMs: number;
  readonly #clock: Clock;
  #tail: Promise<unknown> = Promise.resolve();
  #lastStart: number | undefined;

  constructor(options: RequestThrottleOptions) {
    this.#minIntervalMs = options.minIntervalMs;
    this.#clock = options.clock ?? systemClock;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(async () => {
      if (this.#lastStart !== undefined) {
        const wait = this.#lastStart + this.#minIntervalMs - this.#clock.now();
        if (wait > 0) await this.#clock.sleep(wait);
      }
      this.#lastStart = this.#clock.now();
      return fn();
    });
    this.#tail = result.catch(() => undefined);
    return result;
  }
}
