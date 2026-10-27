import { describe, expect, it } from 'vitest';
import { REDACTED, redactSecrets, redactUrl } from '../../src/api/redact.ts';

const TOKEN = 'abcDEF123-secret_token.value';

describe('redactUrl', () => {
  it('クエリの token を伏せる', () => {
    const url = new URL(`https://atnd.ak4.jp/api/cooperation/acme/stamps?token=${TOKEN}&page=1`);
    const out = redactUrl(url);
    expect(out).not.toContain(TOKEN);
    expect(out).toBe(`https://atnd.ak4.jp/api/cooperation/acme/stamps?token=${REDACTED}&page=1`);
  });

  it('文字列の URL も受け付ける', () => {
    expect(redactUrl(`https://atnd.ak4.jp/x?token=${TOKEN}`)).not.toContain(TOKEN);
  });
});

describe('redactSecrets', () => {
  it('既知のトークン文字列をすべて伏せる', () => {
    const text = `failed: ${TOKEN} and again ${TOKEN}`;
    expect(redactSecrets(text, [TOKEN])).toBe(`failed: ${REDACTED} and again ${REDACTED}`);
  });

  it('URL エンコードされたトークンも伏せる', () => {
    const tricky = 'a+b/c=d';
    const text = `GET https://atnd.ak4.jp/x?token=${encodeURIComponent(tricky)}`;
    expect(redactSecrets(text, [tricky])).not.toContain(encodeURIComponent(tricky));
  });

  it('トークンを知らなくても token= パラメータや JSON の token 値を伏せる', () => {
    expect(redactSecrets('url ...?token=zzz999&x=1')).toBe(`url ...?token=${REDACTED}&x=1`);
    expect(redactSecrets('{"token":"zzz999","a":1}')).toBe(`{"token":"${REDACTED}","a":1}`);
    expect(redactSecrets("{ token: 'zzz999' }")).toBe(`{ token: '${REDACTED}' }`);
  });

  it('空や短すぎる秘密情報は置換に使わない（誤爆防止）', () => {
    expect(redactSecrets('abc', ['', 'a'])).toBe('abc');
  });

  it('正規表現の特殊文字を含むトークンも安全に扱う', () => {
    const special = 'a.b*c+d?(e)[f]';
    expect(redactSecrets(`x ${special} y`, [special])).toBe(`x ${REDACTED} y`);
  });
});
