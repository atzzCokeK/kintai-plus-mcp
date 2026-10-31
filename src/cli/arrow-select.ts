import { emitKeypressEvents, type Key } from 'node:readline';
import type { Readable } from 'node:stream';

export interface ArrowChoice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export type SelectOutcome<T extends string> =
  | { status: 'selected'; value: T }
  | { status: 'cancelled' };

export interface KeypressInput extends Readable {
  isTTY?: boolean;
  setRawMode(mode: boolean): void;
}

/** 現在のカーソル位置を含む一覧。先頭行が message。 */
export function renderArrowSelect<T extends string>(
  message: string,
  choices: readonly ArrowChoice<T>[],
  selected: number,
): string {
  const width = Math.max(...choices.map((choice) => choice.label.length));
  const rows = choices.map((choice, index) => {
    const mark = index === selected ? '❯' : ' ';
    const hint = choice.hint ? `  ${choice.hint}` : '';
    return `${mark} ${choice.label.padEnd(width)}${hint}`;
  });
  return [message, ...rows].join('\n');
}

/**
 * ↑/↓ と Enter で選ぶ。Ctrl+C / Ctrl+D / 入力の終端は cancelled。
 * 戻るとき raw mode を解除し、keypress の待ちを外す。
 */
export async function promptArrowSelect<T extends string>(options: {
  message: string;
  choices: readonly ArrowChoice<T>[];
  defaultValue: T;
  input: KeypressInput;
  output: NodeJS.WritableStream;
}): Promise<SelectOutcome<T>> {
  const { choices, input, output } = options;
  if (choices.length === 0) throw new Error('promptArrowSelect requires choices');
  const found = choices.findIndex((choice) => choice.value === options.defaultValue);
  let selected = found === -1 ? 0 : found;

  const paint = (redraw: boolean) => {
    const lines = renderArrowSelect(options.message, choices, selected).split('\n');
    if (redraw) output.write(`\u001b[${lines.length}A\r`);
    output.write(`${lines.map((line) => `\u001b[2K${line}`).join('\n')}\n`);
  };

  emitKeypressEvents(input);

  let onKey: ((str: string, key: Key) => void) | undefined;
  let onEnd: (() => void) | undefined;
  let raw = false;
  try {
    input.setRawMode(true);
    raw = true;
    input.resume();
    paint(false);
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (outcome: SelectOutcome<T>) => {
        if (settled) return;
        settled = true;
        resolve(outcome);
      };
      onKey = (_str, key) => {
        if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
          finish({ status: 'cancelled' });
          return;
        }
        if (key.name === 'up') {
          selected = (selected - 1 + choices.length) % choices.length;
          paint(true);
          return;
        }
        if (key.name === 'down') {
          selected = (selected + 1) % choices.length;
          paint(true);
          return;
        }
        if (key.name === 'return' || key.name === 'enter') {
          const choice = choices[selected];
          finish(choice ? { status: 'selected', value: choice.value } : { status: 'cancelled' });
        }
      };
      onEnd = () => finish({ status: 'cancelled' });
      input.on('keypress', onKey);
      input.on('end', onEnd);
    });
  } finally {
    if (onKey) input.removeListener('keypress', onKey);
    if (onEnd) input.removeListener('end', onEnd);
    if (raw) input.setRawMode(false);
    input.pause();
  }
}
