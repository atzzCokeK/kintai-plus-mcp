import { describe, expect, it } from 'vitest';
import { buildApiUrl, isApiHost, parseApiHost } from '../../src/api/endpoint.ts';

describe('isApiHost / parseApiHost', () => {
  it('2 つの接続先だけを受け付ける', () => {
    expect(isApiHost('atnd.ak4.jp')).toBe(true);
    expect(isApiHost('atnd-awj.ak4.jp')).toBe(true);
    expect(isApiHost('evil.example.com')).toBe(false);
  });

  it('URL やスキーム付き・大文字・末尾スラッシュでも接続先を取り出せる', () => {
    expect(parseApiHost('https://atnd-awj.ak4.jp/login')).toBe('atnd-awj.ak4.jp');
    expect(parseApiHost('ATND.AK4.JP')).toBe('atnd.ak4.jp');
    expect(parseApiHost(' atnd.ak4.jp/ ')).toBe('atnd.ak4.jp');
  });

  it('対象外のホストは undefined', () => {
    expect(parseApiHost('https://atnd.ak4.jp.evil.example.com/')).toBeUndefined();
    expect(parseApiHost('')).toBeUndefined();
  });
});

describe('buildApiUrl', () => {
  const conn = { host: 'atnd.ak4.jp', companyId: 'acme01' } as const;

  it('企業 ID をパスに含めた URL を組み立てる', () => {
    const url = buildApiUrl(conn, ['{companyId}', 'stamps']);
    expect(url.toString()).toBe('https://atnd.ak4.jp/api/cooperation/acme01/stamps');
  });

  it('企業 ID を含まないパス（勤務処理など）も組み立てられる', () => {
    const url = buildApiUrl(conn, ['working_statuses', 'search']);
    expect(url.toString()).toBe('https://atnd.ak4.jp/api/cooperation/working_statuses/search');
  });

  it('パスの各部分はエンコードし、ディレクトリ移動を許さない', () => {
    expect(() => buildApiUrl(conn, ['{companyId}', '..', 'x'])).toThrow();
    const url = buildApiUrl(conn, ['{companyId}', 'tasks', 'a/b']);
    expect(url.pathname).toBe('/api/cooperation/acme01/tasks/a%2Fb');
  });

  it('数値のパス要素を受け付ける', () => {
    const url = buildApiUrl(conn, ['{companyId}', 'staffs', 123]);
    expect(url.pathname).toBe('/api/cooperation/acme01/staffs/123');
  });

  it('クエリを付ける（undefined は省略、配列はカンマ区切り）', () => {
    const url = buildApiUrl(conn, ['{companyId}', 'working_records'], {
      staff_ids: [1, 2, 3],
      start_date: '20261001',
      page: 0,
      skip: undefined,
    });
    expect(url.search).toBe('?staff_ids=1%2C2%2C3&start_date=20261001&page=0');
  });

  it('不正な企業 ID や接続先は拒否する', () => {
    expect(() => buildApiUrl({ host: 'atnd.ak4.jp', companyId: '' }, ['{companyId}'])).toThrow();
    expect(() => buildApiUrl({ host: 'atnd.ak4.jp', companyId: 'a/b' }, ['{companyId}'])).toThrow();
    expect(() =>
      // @ts-expect-error 型で弾かれる値でも実行時に検証する
      buildApiUrl({ host: 'evil.example.com', companyId: 'acme' }, ['{companyId}']),
    ).toThrow();
  });
});
