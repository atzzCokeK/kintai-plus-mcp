import { describe, expect, it } from 'vitest';
import { parseCredentials, serializeCredentials } from '../../src/credentials/types.ts';

const valid = {
  version: 1,
  host: 'atnd.ak4.jp',
  companyId: 'acme',
  token: 'secret-token-abc',
  expiresAt: '2026-11-28T09:00:00.000Z',
  staffId: 12,
  updatedAt: '2026-10-27T00:00:00.000Z',
};

describe('parseCredentials', () => {
  it('正しい形なら読める', () => {
    expect(parseCredentials(JSON.stringify(valid))).toEqual(valid);
  });

  it('expiresAt・staffId は省略できる', () => {
    const { expiresAt: _e, staffId: _s, ...rest } = valid;
    expect(parseCredentials(JSON.stringify(rest))).toEqual(rest);
  });

  it('壊れた JSON や不正な値はエラー。メッセージにトークンを含めない', () => {
    expect(() => parseCredentials('{')).toThrow(/credentials/i);
    const bad = JSON.stringify({ ...valid, host: 'evil.example.com' });
    expect(() => parseCredentials(bad)).toThrow();
    try {
      parseCredentials(bad);
    } catch (e) {
      expect(String(e)).not.toContain(valid.token);
    }
  });

  it('serialize → parse で元に戻る', () => {
    expect(parseCredentials(serializeCredentials(valid as never))).toEqual(valid);
  });
});
