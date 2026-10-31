import { createInterface, type Interface } from 'node:readline';
import { Writable } from 'node:stream';
import type { CliIO } from './main.ts';

/**
 * 端末用の入出力。プロンプトは stderr に出し、トークン入力中はエコーを止める。
 * パイプからの入力でも行を取りこぼさないよう、読んだ行はキューに溜める。
 */
export function createNodeIO(): CliIO & { close(): void } {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stderr.write(chunk);
      callback();
    },
  });

  const lines: string[] = [];
  const waiters: Array<(line: string | undefined) => void> = [];
  let closed = false;
  let rl: Interface | undefined;

  const start = () => {
    if (rl) return;
    rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY === true });
    rl.on('line', (line) => {
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lines.push(line);
    });
    rl.on('close', () => {
      closed = true;
      for (const waiter of waiters.splice(0)) waiter(undefined);
    });
  };

  const nextLine = (): Promise<string> => {
    start();
    const line = lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (closed) return Promise.reject(new Error('Input ended before all answers were given'));
    return new Promise((resolve, reject) => {
      waiters.push((l) => (l === undefined ? reject(new Error('Input ended')) : resolve(l)));
    });
  };

  return {
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    async prompt(question) {
      process.stderr.write(question);
      return nextLine();
    },
    async promptSecret(question) {
      process.stderr.write(question);
      muted = true;
      try {
        return await nextLine();
      } finally {
        muted = false;
        if (process.stdin.isTTY) process.stderr.write('\n');
      }
    },
    interactive: process.stdin.isTTY === true,
    close: () => rl?.close(),
  };
}
