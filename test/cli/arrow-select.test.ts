import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { promptArrowSelect, renderArrowSelect } from '../../src/cli/arrow-select.ts';
import { HOST_SELECT_MESSAGE, hostSelectChoices } from '../../src/cli/host-prompt.ts';

const FRAME = [
  '接続先（ログイン後のブラウザの URL のドメイン）',
  '↑/↓ で移動、Enter で決定',
  '❯ atnd.ak4.jp      https://atnd.ak4.jp/ でログインしている（既定）',
  '  atnd-awj.ak4.jp  https://atnd-awj.ak4.jp/ でログインしている',
].join('\n');

const MOVED = [
  '接続先（ログイン後のブラウザの URL のドメイン）',
  '↑/↓ で移動、Enter で決定',
  '  atnd.ak4.jp      https://atnd.ak4.jp/ でログインしている（既定）',
  '❯ atnd-awj.ak4.jp  https://atnd-awj.ak4.jp/ でログインしている',
].join('\n');

class FakeStdin extends PassThrough {
  isTTY = true;
  raw = false;
  setRawMode(mode: boolean) {
    this.raw = mode;
    return this;
  }
}

function capture() {
  let text = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      text += String(chunk);
      callback();
    },
  });
  return {
    output,
    text: () =>
      text
        .replaceAll(new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*[A-Za-z]`, 'g'), '')
        .replaceAll('\r', ''),
  };
}

describe('renderArrowSelect', () => {
  it('既定の atnd.ak4.jp にカーソルを置く', () => {
    const choices = hostSelectChoices();
    expect(renderArrowSelect(HOST_SELECT_MESSAGE, choices, 0)).toBe(FRAME);
    expect(renderArrowSelect(HOST_SELECT_MESSAGE, choices, 1)).toBe(MOVED);
  });
});

describe('promptArrowSelect', () => {
  const choices = hostSelectChoices();

  it('Enter だけなら既定の atnd.ak4.jp。raw mode と keypress は戻す', async () => {
    const input = new FakeStdin();
    const screen = capture();
    const pending = promptArrowSelect({
      message: HOST_SELECT_MESSAGE,
      choices,
      defaultValue: 'atnd.ak4.jp',
      input,
      output: screen.output,
    });
    expect(screen.text()).toBe(`${FRAME}\n`);
    input.write('\r');
    await expect(pending).resolves.toEqual({ status: 'selected', value: 'atnd.ak4.jp' });
    expect(input.raw).toBe(false);
    expect(input.listenerCount('keypress')).toBe(0);
  });

  it('↓ で次を選び、↑ は先頭から末尾へ回る', async () => {
    const downInput = new FakeStdin();
    const downScreen = capture();
    const down = promptArrowSelect({
      message: HOST_SELECT_MESSAGE,
      choices,
      defaultValue: 'atnd.ak4.jp',
      input: downInput,
      output: downScreen.output,
    });
    downInput.write('\u001b[B');
    downInput.write('\r');
    await expect(down).resolves.toEqual({ status: 'selected', value: 'atnd-awj.ak4.jp' });
    expect(downScreen.text()).toContain(MOVED);

    const upInput = new FakeStdin();
    const up = promptArrowSelect({
      message: HOST_SELECT_MESSAGE,
      choices,
      defaultValue: 'atnd.ak4.jp',
      input: upInput,
      output: capture().output,
    });
    upInput.write('\u001b[A\r');
    await expect(up).resolves.toEqual({ status: 'selected', value: 'atnd-awj.ak4.jp' });
    expect(upInput.raw).toBe(false);
  });

  it('Ctrl+C はキャンセルし、そのあと別の選択ができる', async () => {
    const input = new FakeStdin();
    const screen = capture();
    const pending = promptArrowSelect({
      message: HOST_SELECT_MESSAGE,
      choices,
      defaultValue: 'atnd.ak4.jp',
      input,
      output: screen.output,
    });
    input.write('\u0003');
    await expect(pending).resolves.toEqual({ status: 'cancelled' });
    expect(input.raw).toBe(false);
    expect(input.listenerCount('keypress')).toBe(0);

    const again = promptArrowSelect({
      message: HOST_SELECT_MESSAGE,
      choices,
      defaultValue: 'atnd.ak4.jp',
      input,
      output: screen.output,
    });
    input.write('\r');
    await expect(again).resolves.toEqual({ status: 'selected', value: 'atnd.ak4.jp' });
  });
});
