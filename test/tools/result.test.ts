import { describe, expect, it } from 'vitest';
import { KintaiApiError } from '../../src/api/errors.ts';
import { LimitExceededError } from '../../src/api/paging.ts';
import { NotLoggedInError, TokenExpiredError } from '../../src/credentials/token-manager.ts';
import { errorResult, successResult, ToolInputError } from '../../src/tools/result.ts';

const text = (r: { content: Array<{ type: string; text?: string }> }) =>
  r.content.map((c) => c.text ?? '').join('');

describe('successResult', () => {
  it('JSON をテキストで返す', () => {
    const r = successResult({ a: 1, b: '日本語' });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(text(r))).toEqual({ a: 1, b: '日本語' });
  });
});

describe('errorResult', () => {
  it.each([
    [new NotLoggedInError(), /login/],
    [new TokenExpiredError(), /マイページ/],
    [new KintaiApiError({ kind: 'auth', message: 'x' }), /login/],
    [new KintaiApiError({ kind: 'unknown_company', message: 'x' }), /company ID/i],
    [new KintaiApiError({ kind: 'forbidden', message: 'x' }), /permission/i],
    [new KintaiApiError({ kind: 'not_found', message: 'x' }), /ID/],
    [new KintaiApiError({ kind: 'invalid_request', message: 'bad date' }), /bad date/],
    [new KintaiApiError({ kind: 'rate_limited', message: 'x' }), /wait/i],
    [new KintaiApiError({ kind: 'network', message: 'x' }), /retry/i],
    [new LimitExceededError('too long'), /shorter|narrow/i],
    [new ToolInputError('from must be before to'), /from must be before to/],
  ])('%s は isError とヒントを返す', (error, pattern) => {
    const r = errorResult(error);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(pattern);
  });

  it('想定外のエラーでもトークンらしき値は伏せる', () => {
    const r = errorResult(new Error('boom https://x/?token=abcdef123456'));
    expect(text(r)).not.toContain('abcdef123456');
    expect(text(r)).toContain('boom');
  });
});
