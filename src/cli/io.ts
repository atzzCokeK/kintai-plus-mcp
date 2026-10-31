import { createInterface, type Interface } from 'node:readline';
import { Writable } from 'node:stream';
import { type KeypressInput, promptArrowSelect } from './arrow-select.ts';
import type { CliIO } from './main.ts';

/**
 * 端末用の入出力。プロンプトは stderr に出し、トークン入力中はエコーを止める。
 * パイプからの入力でも行を取りこぼさないよう、読んだ行はキューに溜める。
 * 矢印選択の前に readline を閉じ、終わったら raw mode を戻して次の質問で開き直す。
 */
export function createNodeIO(streams?: {
  input?: KeypressInput;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}): CliIO & { close(): void } {
  const input = streams?.input ?? process.stdin;
  const stdout = streams?.stdout ?? process.stdout;
  const stderr = streams?.stderr ?? process.stderr;

  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) stderr.write(chunk);
      callback();
    },
  });

  const lines: string[] = [];
  const waiters: Array<(line: string | undefined) => void> = [];
  let closed = false;
  let releasing = false;
  let rl: Interface | undefined;

  const start = () => {
    if (rl) return;
    rl = createInterface({ input, output, terminal: input.isTTY === true });
    rl.on('line', (line) => {
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lines.push(line);
    });
    rl.on('close', () => {
      if (releasing) return;
      closed = true;
      rl = undefined;
      for (const waiter of waiters.splice(0)) waiter(undefined);
    });
  };

  const releaseReadline = () => {
    const current = rl;
    if (!current) return;
    releasing = true;
    current.close();
    releasing = false;
    rl = undefined;
    closed = false;
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
      stdout.write(text);
    },
    stderr: (text) => {
      stderr.write(text);
    },
    async prompt(question) {
      stderr.write(question);
      return nextLine();
    },
    async promptSecret(question) {
      stderr.write(question);
      muted = true;
      try {
        return await nextLine();
      } finally {
        muted = false;
        if (input.isTTY) stderr.write('\n');
      }
    },
    promptSelect(spec) {
      releaseReadline();
      return promptArrowSelect({ ...spec, input, output: stderr });
    },
    interactive: input.isTTY === true,
    close: () => rl?.close(),
  };
}
