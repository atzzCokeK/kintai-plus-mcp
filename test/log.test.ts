import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.ts';

describe('createLogger', () => {
  it('レベル未満のログは出さない', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'warn', write: (s) => lines.push(s) });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(lines).toEqual(['[kintai-plus-mcp] warn: w\n', '[kintai-plus-mcp] error: e\n']);
  });

  it('token= や登録済みの秘密情報を伏せる', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'debug', write: (s) => lines.push(s) });
    log.addSecret('my-secret-token-xyz');
    log.debug('GET https://atnd.ak4.jp/x?token=abc123456 my-secret-token-xyz');
    expect(lines.join('')).not.toContain('abc123456');
    expect(lines.join('')).not.toContain('my-secret-token-xyz');
  });

  it('既定の出力先は stderr（stdout は MCP の通信路）', () => {
    const log = createLogger({ level: 'info' });
    expect(log.target).toBe('stderr');
  });
});
