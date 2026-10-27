import { type Logger, silentLogger } from '../log.ts';
import { PACKAGE_NAME, VERSION } from '../version.ts';
import {
  appendQuery,
  buildApiUrl,
  type Connection,
  type PathSegment,
  type Query,
} from './endpoint.ts';
import { KintaiApiError, parseEnvelope } from './errors.ts';
import { redactSecrets, redactUrl } from './redact.ts';
import { RequestThrottle, systemClock } from './throttle.ts';

export interface KintaiApiClientOptions {
  connection: Connection;
  /** 現在有効なトークンを返す（T3 の自動更新はここに差し込む） */
  getToken: () => Promise<string>;
  fetch?: typeof fetch;
  throttle?: RequestThrottle;
  /** 1 リクエストのタイムアウト（既定 30 秒） */
  timeoutMs?: number;
  /** 再試行までの待ち時間（既定 1 秒） */
  retryDelayMs?: number;
  logger?: Logger;
}

export interface RequestOptions {
  /** 保存済みのトークンの代わりに使うトークン（再発行 API 用） */
  token?: string;
}

type Method = 'GET' | 'POST' | 'DELETE';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
/** 既定の最小リクエスト間隔。レート制限の記載がないため控えめにする。 */
export const DEFAULT_MIN_INTERVAL_MS = 300;

export class KintaiApiClient {
  readonly connection: Connection;
  readonly #getToken: () => Promise<string>;
  readonly #fetch: typeof fetch;
  readonly #throttle: RequestThrottle;
  readonly #timeoutMs: number;
  readonly #retryDelayMs: number;
  readonly #logger: Logger;

  constructor(options: KintaiApiClientOptions) {
    this.connection = options.connection;
    this.#getToken = options.getToken;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#throttle =
      options.throttle ?? new RequestThrottle({ minIntervalMs: DEFAULT_MIN_INTERVAL_MS });
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.#logger = options.logger ?? silentLogger;
  }

  get<T = unknown>(segments: readonly PathSegment[], query?: Query, options?: RequestOptions) {
    return this.#request<T>('GET', segments, { query, ...options });
  }

  post<T = unknown>(
    segments: readonly PathSegment[],
    body: Record<string, unknown> = {},
    options?: RequestOptions,
  ) {
    return this.#request<T>('POST', segments, { body, ...options });
  }

  delete<T = unknown>(segments: readonly PathSegment[], query?: Query, options?: RequestOptions) {
    return this.#request<T>('DELETE', segments, { query, ...options });
  }

  async #request<T>(
    method: Method,
    segments: readonly PathSegment[],
    params: { query?: Query | undefined; body?: Record<string, unknown>; token?: string },
  ): Promise<T> {
    const token = params.token ?? (await this.#getToken());
    this.#logger.addSecret(token);

    const url = buildApiUrl(this.connection, segments, params.query);
    const init: RequestInit = {
      method,
      headers: {
        accept: 'application/json',
        'user-agent': `${PACKAGE_NAME}/${VERSION}`,
      },
    };
    if (method === 'POST') {
      init.headers = { ...init.headers, 'content-type': 'application/json' };
      init.body = JSON.stringify({ ...params.body, token });
    } else {
      appendQuery(url, { token });
    }

    // 書き込みは再試行しない（打刻は到着時刻で記録され、二重打刻になりうる）
    const attempts = method === 'GET' ? 2 : 1;
    for (let attempt = 1; ; attempt++) {
      try {
        return (await this.#throttle.run(() => this.#send(url, init, token))) as T;
      } catch (error) {
        const retry = error instanceof KintaiApiError && error.retryable && attempt < attempts;
        if (!retry) throw error;
        this.#logger.warn(`${method} ${redactUrl(url)} failed (${error.kind}); retrying`);
        await systemClock.sleep(this.#retryDelayMs);
      }
    }
  }

  async #send(url: URL, init: RequestInit, token: string): Promise<unknown> {
    const label = `${init.method} ${redactUrl(url)}`;
    const started = Date.now();
    let response: Response;
    try {
      response = await this.#fetch(url, { ...init, signal: AbortSignal.timeout(this.#timeoutMs) });
    } catch (error) {
      throw toTransportError(error, token);
    }
    const text = await response.text();
    this.#logger.debug(`${label} -> HTTP ${response.status} (${Date.now() - started}ms)`);
    try {
      return parseEnvelope(response.status, text, [token]);
    } catch (error) {
      if (error instanceof KintaiApiError) this.#logger.debug(`${label}: ${error.message}`);
      throw error;
    }
  }
}

function toTransportError(error: unknown, token: string): KintaiApiError {
  const isTimeout =
    error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  const raw = error instanceof Error ? error.message : String(error);
  const code = errorCode(error);
  // 元のエラー（cause）は URL を含みうるので持ち回らない
  return new KintaiApiError({
    kind: isTimeout ? 'timeout' : 'network',
    message: redactSecrets(
      isTimeout
        ? 'Request to Kintai Plus timed out'
        : `Could not reach Kintai Plus: ${raw}${code ? ` (${code})` : ''}`,
      [token],
    ),
  });
}

function errorCode(error: unknown): string | undefined {
  const cause = error instanceof Error ? error.cause : undefined;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    return String((cause as { code: unknown }).code);
  }
  return undefined;
}
