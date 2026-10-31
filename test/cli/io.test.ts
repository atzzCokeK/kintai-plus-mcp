import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { hostSelectChoices } from '../../src/cli/host-prompt.ts';
import { createNodeIO } from '../../src/cli/io.ts';

class FakeStdin extends PassThrough {
  isTTY = true;
  raw = false;
  setRawMode(mode: boolean) {
    this.raw = mode;
    return this;
  }
}

function stderrCapture() {
  const chunks: string[] = [];
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const stdout = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  return { stderr, stdout, text: () => chunks.join('') };
}

describe('createNodeIO', () => {
  const previous = process.stdin.isTTY;
  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: previous, configurable: true });
  });

  it('stdin が TTY のときだけ interactive', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const tty = createNodeIO();
    expect(tty.interactive).toBe(true);
    tty.close();

    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    const piped = createNodeIO();
    expect(piped.interactive).toBe(false);
    piped.close();
  });

  it('企業 ID のあと矢印で選び、raw mode を戻してからトークンを読める', async () => {
    const input = new FakeStdin();
    const screen = stderrCapture();
    const io = createNodeIO({ input, stdout: screen.stdout, stderr: screen.stderr });
    const company = io.prompt('ログイン企業ID: ');
    input.write('acme\n');
    await expect(company).resolves.toBe('acme');

    const selected = io.promptSelect({
      message: '接続先',
      choices: hostSelectChoices(),
      defaultValue: 'atnd.ak4.jp',
    });
    input.write('\u001b[B\r');
    await expect(selected).resolves.toEqual({ status: 'selected', value: 'atnd-awj.ak4.jp' });
    expect(input.raw).toBe(false);

    const secret = io.promptSecret('APIトークン（入力は表示されません）: ');
    input.write('s3cret\n');
    await expect(secret).resolves.toBe('s3cret');
    expect(screen.text()).not.toContain('s3cret');
    io.close();
  });

  it('選択中の Ctrl+C のあとでも次の入力を読める', async () => {
    const input = new FakeStdin();
    const screen = stderrCapture();
    const io = createNodeIO({ input, stdout: screen.stdout, stderr: screen.stderr });
    const selected = io.promptSelect({
      message: '接続先',
      choices: hostSelectChoices(),
      defaultValue: 'atnd.ak4.jp',
    });
    input.write('\u0003');
    await expect(selected).resolves.toEqual({ status: 'cancelled' });
    expect(input.raw).toBe(false);

    const company = io.prompt('ログイン企業ID: ');
    input.write('acme\n');
    await expect(company).resolves.toBe('acme');
    io.close();
  });
});
