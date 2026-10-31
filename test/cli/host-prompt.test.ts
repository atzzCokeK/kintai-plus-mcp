import { describe, expect, it } from 'vitest';
import { API_HOSTS } from '../../src/api/endpoint.ts';
import {
  formatInteractiveHostPrompt,
  interactiveHostError,
  parseHostSelection,
} from '../../src/cli/host-prompt.ts';

const PROMPT = [
  '接続先（ログイン後のブラウザの URL のドメイン）:',
  '  1) atnd.ak4.jp      https://atnd.ak4.jp/ でログインしている（既定）',
  '  2) atnd-awj.ak4.jp  https://atnd-awj.ak4.jp/ でログインしている',
  '番号 [1]: ',
].join('\n');

describe('formatInteractiveHostPrompt', () => {
  it('既知の接続先を番号で示し、atnd.ak4.jp を既定にする', () => {
    expect(formatInteractiveHostPrompt()).toBe(PROMPT);
    for (const [i, host] of API_HOSTS.entries()) {
      expect(PROMPT).toContain(`${i + 1}) ${host}`);
    }
  });
});

describe('parseHostSelection', () => {
  it('空入力と 1 は atnd.ak4.jp', () => {
    expect(parseHostSelection('')).toBe('atnd.ak4.jp');
    expect(parseHostSelection('   ')).toBe('atnd.ak4.jp');
    expect(parseHostSelection('1')).toBe('atnd.ak4.jp');
  });

  it('2 は atnd-awj.ak4.jp。前後の空白は無視する', () => {
    expect(parseHostSelection('2')).toBe('atnd-awj.ak4.jp');
    expect(parseHostSelection('  2  ')).toBe('atnd-awj.ak4.jp');
  });

  it('ホスト名とログイン URL も受け付ける', () => {
    expect(parseHostSelection('atnd-awj.ak4.jp')).toBe('atnd-awj.ak4.jp');
    expect(parseHostSelection('https://atnd.ak4.jp/ja/login')).toBe('atnd.ak4.jp');
    expect(parseHostSelection('ATND.AK4.JP')).toBe('atnd.ak4.jp');
  });

  it('範囲外の番号と未知のホストは拒否する', () => {
    expect(parseHostSelection('0')).toBeUndefined();
    expect(parseHostSelection('3')).toBeUndefined();
    expect(parseHostSelection('01')).toBeUndefined();
    expect(parseHostSelection('evil.example.com')).toBeUndefined();
  });
});

describe('interactiveHostError', () => {
  it('選べる番号と接続先を案内する', () => {
    expect(interactiveHostError()).toBe(
      '接続先は番号で選んでください（1: atnd.ak4.jp、2: atnd-awj.ak4.jp）。\n',
    );
  });
});
