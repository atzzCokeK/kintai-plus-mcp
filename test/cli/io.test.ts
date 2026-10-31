import { afterEach, describe, expect, it } from 'vitest';
import { createNodeIO } from '../../src/cli/io.ts';

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
});
