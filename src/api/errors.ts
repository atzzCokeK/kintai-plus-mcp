import { redactSecrets } from './redact.ts';

export type ApiErrorKind =
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'timeout'
  | 'invalid_response';

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
    return body.response ?? null;
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
  throw new KintaiApiError({
    kind,
    status,
    apiErrors,
    message: `Kintai Plus API error (HTTP ${status}): ${summary}`,
  });
}

function classify(status: number, errors: ApiErrorDetail[]): ApiErrorKind {
  if (isHttpError(status)) return kindFromStatus(status);
  const looksLikeAuth = errors.some(
    (e) => AUTH_HINT.test(e.code ?? '') || AUTH_HINT.test(e.message ?? ''),
  );
  return looksLikeAuth ? 'auth' : 'invalid_request';
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
