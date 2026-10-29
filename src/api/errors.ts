import { redactSecrets } from './redact.ts';

export type ApiErrorKind =
  | 'auth'
  | 'unknown_company'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'timeout'
  | 'invalid_response';

/** 実環境（2026-10-29）で観測したエラーコード。コードは文字列。 */
export const API_CODE = {
  invalidToken: 'ERR300002',
  unknownCompany: 'ERR300001',
  invalidDate: 'ERR301001',
  pageOutOfRange: 'ERR300602',
  noProjects: 'ERR301900',
  missingStaffIds: 'ERR301603',
  rangeTooLong: 'ERR301601',
} as const;

const PARAM_ERROR_CODES: ReadonlySet<string> = new Set([
  API_CODE.invalidDate,
  API_CODE.pageOutOfRange,
  API_CODE.missingStaffIds,
  API_CODE.rangeTooLong,
]);

export interface ApiErrorDetail {
  code: string | null;
  message: string | null;
}

export interface KintaiApiErrorInit {
  kind: ApiErrorKind;
  message: string;
  status?: number;
  apiErrors?: ApiErrorDetail[];
  cause?: unknown;
}

const RETRYABLE: ReadonlySet<ApiErrorKind> = new Set([
  'rate_limited',
  'server',
  'network',
  'timeout',
]);

/** API 呼び出しの失敗を表す。message・apiErrors はトークン除去済み。 */
export class KintaiApiError extends Error {
  override readonly name = 'KintaiApiError';
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  readonly apiErrors: ApiErrorDetail[];

  constructor(init: KintaiApiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    this.status = init.status;
    this.apiErrors = init.apiErrors ?? [];
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

const MAX_BODY_EXCERPT = 300;
const AUTH_HINT = /token|トークン|認証/i;

/**
 * 共通レスポンス `{ success, response, errors }` を解釈する。
 * 成功なら response を返し、失敗なら KintaiApiError を投げる。
 */
export function parseEnvelope(
  status: number,
  bodyText: string,
  secrets: readonly (string | undefined)[] = [],
): unknown {
  const redact = (s: string) => redactSecrets(s, secrets);
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    const excerpt = redact(bodyText.slice(0, MAX_BODY_EXCERPT));
    throw new KintaiApiError({
      kind: isHttpError(status) ? kindFromStatus(status) : 'invalid_response',
      status,
      message: `Unexpected non-JSON response (HTTP ${status}): ${excerpt}`,
    });
  }

  if (!isRecord(body) || typeof body.success !== 'boolean') {
    throw new KintaiApiError({
      kind: isHttpError(status) ? kindFromStatus(status) : 'invalid_response',
      status,
      message: `Unexpected response shape (HTTP ${status})`,
    });
  }

  if (body.success && !isHttpError(status)) {
    // 多くの API は response に中身を入れる。勤務処理取得は response が無く results を返す。
    if ('response' in body) return body.response ?? null;
    return body;
  }

  const apiErrors = normalizeErrors(body.errors).map((e) => ({
    code: e.code === null ? null : redact(e.code),
    message: e.message === null ? null : redact(e.message),
  }));
  const kind = classify(status, apiErrors);
  const summary =
    apiErrors
      .map((e) => [e.code, e.message].filter((v) => v !== null).join(': '))
      .filter((s) => s !== '')
      .join(' / ') || 'no error details';
  const message =
    kind === 'unknown_company'
      ? `Kintai Plus API error (HTTP ${status}): ${summary}. The company ID (ログイン企業ID) does not match a company. Check the company ID and the host (atnd.ak4.jp or atnd-awj.ak4.jp).`
      : `Kintai Plus API error (HTTP ${status}): ${summary}`;
  throw new KintaiApiError({ kind, status, apiErrors, message });
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof KintaiApiError && error.apiErrors.some((e) => e.code === code);
}

/**
 * エラーコードを HTTP ステータスより先に見る。
 * 無効トークンは 404 で返るため、ステータスだけで見ると not_found になり再発行の案内に届かない。
 */
function classify(status: number, errors: ApiErrorDetail[]): ApiErrorKind {
  if (errors.some((e) => e.code === API_CODE.invalidToken || looksLikeAuth(e))) return 'auth';
  if (errors.some((e) => e.code === API_CODE.unknownCompany)) return 'unknown_company';
  if (errors.some((e) => e.code !== null && PARAM_ERROR_CODES.has(e.code)))
    return 'invalid_request';
  if (isHttpError(status)) return kindFromStatus(status);
  return 'invalid_request';
}

function looksLikeAuth(error: ApiErrorDetail): boolean {
  return AUTH_HINT.test(error.code ?? '') || AUTH_HINT.test(error.message ?? '');
}

export function kindFromStatus(status: number): ApiErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'invalid_request';
}

function isHttpError(status: number): boolean {
  return status >= 400;
}

function normalizeErrors(value: unknown): ApiErrorDetail[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!isRecord(item)) return { code: null, message: String(item) };
    return {
      code: item.code == null ? null : String(item.code),
      message: item.message == null ? null : String(item.message),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
