import { describe, expect, it } from 'vitest';
import { KintaiApiError, parseEnvelope } from '../../src/api/errors.ts';

const TOKEN = 'very-secret-token-123';

function catchError(fn: () => unknown): KintaiApiError {
  try {
    fn();
  } catch (e) {
    if (e instanceof KintaiApiError) return e;
    throw e;
  }
  throw new Error('did not throw');
}

describe('parseEnvelope', () => {
  it('success: true なら response を返す', () => {
    const body = JSON.stringify({ success: true, response: { staff_id: 1 } });
    expect(parseEnvelope(200, body)).toEqual({ staff_id: 1 });
  });

  it('success: false なら errors を持つ KintaiApiError を投げる', () => {
    const body = JSON.stringify({
      success: false,
      errors: [{ code: 'ERR_PARAM', message: '期間が不正です' }],
    });
    const err = catchError(() => parseEnvelope(400, body));
    expect(err.kind).toBe('invalid_request');
    expect(err.status).toBe(400);
    expect(err.apiErrors).toEqual([{ code: 'ERR_PARAM', message: '期間が不正です' }]);
    expect(err.message).toContain('期間が不正です');
  });

  it.each([
    [401, 'auth'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [422, 'invalid_request'],
    [429, 'rate_limited'],
    [500, 'server'],
    [503, 'server'],
  ] as const)('HTTP %i は %s に分類する', (status, kind) => {
    const err = catchError(() => parseEnvelope(status, '{"success":false,"errors":[]}'));
    expect(err.kind).toBe(kind);
  });

  it('HTTP 404 でもエラーコードを先に見る（無効トークンを not_found にしない）', () => {
    const token = catchError(() =>
      parseEnvelope(
        404,
        JSON.stringify({
          success: false,
          errors: [{ code: 'ERR300002', message: '指定されたトークンは無効です。' }],
        }),
      ),
    );
    expect(token.kind).toBe('auth');
    expect(token.apiErrors[0]?.code).toBe('ERR300002');

    const company = catchError(() =>
      parseEnvelope(
        404,
        JSON.stringify({
          success: false,
          errors: [{ code: 'ERR300001', message: '指定された企業は存在しません。' }],
        }),
      ),
    );
    expect(company.kind).toBe('unknown_company');
    expect(company.message).toMatch(/ログイン企業ID/);

    const dates = catchError(() =>
      parseEnvelope(
        404,
        JSON.stringify({
          success: false,
          errors: [
            { code: 'ERR301001', message: '開始日が不正です' },
            { code: 'ERR301001', message: '終了日が不正です' },
          ],
        }),
      ),
    );
    expect(dates.kind).toBe('invalid_request');
    expect(dates.message).toContain('開始日が不正です');
    expect(dates.message).toContain('終了日が不正です');
    expect(dates.apiErrors).toHaveLength(2);

    expect(
      catchError(() =>
        parseEnvelope(
          400,
          JSON.stringify({
            success: false,
            errors: [{ code: 'ERR301603', message: 'staff_ids がありません' }],
          }),
        ),
      ).kind,
    ).toBe('invalid_request');
    expect(
      catchError(() =>
        parseEnvelope(
          400,
          JSON.stringify({
            success: false,
            errors: [{ code: 'ERR301601', message: '期間は31日までです' }],
          }),
        ),
      ).kind,
    ).toBe('invalid_request');
  });

  it('success で response が無く results があるときはボディを返す', () => {
    const body = JSON.stringify({
      success: true,
      results: [{ staff_id: '1002' }],
      errors: [],
    });
    expect(parseEnvelope(200, body)).toMatchObject({ results: [{ staff_id: '1002' }] });
  });

  it('HTTP 200 でもトークンに関するエラーは auth に分類する', () => {
    const body = JSON.stringify({
      success: false,
      errors: [{ code: 'TOKEN_EXPIRED', message: 'トークンの有効期限が切れています' }],
    });
    expect(catchError(() => parseEnvelope(200, body)).kind).toBe('auth');
  });

  it('JSON でない本文は invalid_response（本文は短く切り詰め、トークンを伏せる）', () => {
    const html = `<html>${'x'.repeat(5000)} token=${TOKEN}</html>`;
    const err = catchError(() => parseEnvelope(502, html, [TOKEN]));
    expect(err.kind).toBe('server');
    expect(err.message.length).toBeLessThan(600);
    expect(err.message).not.toContain(TOKEN);
    const err200 = catchError(() => parseEnvelope(200, 'not json'));
    expect(err200.kind).toBe('invalid_response');
  });

  it('エラーメッセージにトークンが含まれていても伏せる', () => {
    const body = JSON.stringify({
      success: false,
      errors: [{ code: 'E', message: `invalid token ${TOKEN}` }],
    });
    const err = catchError(() => parseEnvelope(400, body, [TOKEN]));
    expect(err.message).not.toContain(TOKEN);
    expect(JSON.stringify(err.apiErrors)).not.toContain(TOKEN);
  });

  it('success が無い・不正な形なら invalid_response', () => {
    expect(catchError(() => parseEnvelope(200, '{"foo":1}')).kind).toBe('invalid_response');
    expect(catchError(() => parseEnvelope(200, '[]')).kind).toBe('invalid_response');
  });

  it('retryable はレート制限・サーバーエラー・通信エラーで true', () => {
    expect(new KintaiApiError({ kind: 'server', message: 'x' }).retryable).toBe(true);
    expect(new KintaiApiError({ kind: 'rate_limited', message: 'x' }).retryable).toBe(true);
    expect(new KintaiApiError({ kind: 'network', message: 'x' }).retryable).toBe(true);
    expect(new KintaiApiError({ kind: 'auth', message: 'x' }).retryable).toBe(false);
  });
});
