import { KintaiApiError } from '../api/errors.ts';
import type { ReleaseLock } from './lock.ts';
import type { CredentialStore, Credentials } from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export const LOGIN_HINT = 'Run `npx kintai-plus-mcp login` to register your Kintai Plus API token.';

/** 認証情報が登録されていない */
export class NotLoggedInError extends Error {
  override readonly name = 'NotLoggedInError';
  constructor() {
    super(
      `No Kintai Plus credentials found. ${LOGIN_HINT} ` +
        '(Alternatively set KINTAI_PLUS_TOKEN and KINTAI_PLUS_COMPANY_ID.)',
    );
  }
}

/** トークンが失効していて、自動更新もできない */
export class TokenExpiredError extends Error {
  override readonly name = 'TokenExpiredError';
  constructor() {
    super(
      'Your Kintai Plus API token has expired or is no longer valid. ' +
        'Issue a new token from マイページ > APIトークン in クラウド勤怠Plus, ' +
        'then run `npx kintai-plus-mcp login` again.',
    );
  }
}

export interface ReissueResult {
  token: string;
  expiresAt: Date;
  staffId?: number | undefined;
}

export interface TokenManagerOptions {
  store: CredentialStore;
  /** 再発行 API を呼ぶ */
  reissue: (credentials: Credentials) => Promise<ReissueResult>;
  /** プロセス間ロックを取る */
  acquireLock: () => Promise<ReleaseLock>;
  /** 有効期限の残りがこの日数以下になったら再発行する（既定 15） */
  refreshBeforeDays?: number;
  autoRefresh?: boolean;
  /**
   * 有効期限が無いトークンを初回に再発行するか（既定 true）。
   * 環境変数のトークンは false にして、渡した値を無効化しない。
   */
  reissueUnknownExpiry?: boolean;
  now?: () => Date;
  warn?: (message: string) => void;
  /** 保存先を読み直す間隔（既定 60 秒） */
  cacheTtlMs?: number;
  /** 再発行に失敗したあと、次に試すまでの間隔（既定 5 分） */
  retryAfterFailureMs?: number;
}

/**
 * 保存先からトークンを取り出し、期限が近ければ再発行 API で更新する。
 * 複数プロセスでの二重更新はロックで防ぎ、更新前に保存先を読み直す。
 */
export class TokenManager {
  readonly #o: Required<Omit<TokenManagerOptions, 'warn'>> & { warn: (m: string) => void };
  #cache: { credentials: Credentials; loadedAt: number } | undefined;
  #refreshing: Promise<Credentials> | undefined;
  #nextRefreshAttempt = 0;

  constructor(options: TokenManagerOptions) {
    this.#o = {
      refreshBeforeDays: 15,
      autoRefresh: true,
      reissueUnknownExpiry: true,
      now: () => new Date(),
      warn: () => {},
      cacheTtlMs: 60_000,
      retryAfterFailureMs: 5 * 60_000,
      ...options,
    };
  }

  /** 次回は保存先を読み直す（API が認証エラーを返したときなど） */
  invalidate(): void {
    this.#cache = undefined;
  }

  async getCredentials(): Promise<Credentials> {
    let credentials = await this.#load();
    if (this.#o.autoRefresh && this.#needsRefresh(credentials)) {
      credentials = await this.#refreshOnce(credentials);
    }
    if (this.#isExpired(credentials)) throw new TokenExpiredError();
    return credentials;
  }

  async getToken(): Promise<string> {
    return (await this.getCredentials()).token;
  }

  async #load(): Promise<Credentials> {
    const now = this.#o.now().getTime();
    if (this.#cache && now - this.#cache.loadedAt < this.#o.cacheTtlMs) {
      return this.#cache.credentials;
    }
    const credentials = await this.#o.store.load();
    if (!credentials) throw new NotLoggedInError();
    this.#cache = { credentials, loadedAt: now };
    return credentials;
  }

  #needsRefresh(credentials: Credentials): boolean {
    if (credentials.expiresAt === undefined) return this.#o.reissueUnknownExpiry;
    const remaining = Date.parse(credentials.expiresAt) - this.#o.now().getTime();
    return remaining <= this.#o.refreshBeforeDays * DAY_MS;
  }

  #isExpired(credentials: Credentials): boolean {
    return (
      credentials.expiresAt !== undefined &&
      Date.parse(credentials.expiresAt) <= this.#o.now().getTime()
    );
  }

  #refreshOnce(current: Credentials): Promise<Credentials> {
    if (this.#o.now().getTime() < this.#nextRefreshAttempt) return Promise.resolve(current);
    this.#refreshing ??= this.#refresh(current).finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  async #refresh(current: Credentials): Promise<Credentials> {
    let release: ReleaseLock;
    try {
      release = await this.#o.acquireLock();
    } catch (error) {
      this.#warn(`Could not lock for token refresh (${describe(error)}); using the current token.`);
      return this.#fallback(current);
    }
    try {
      // 待っている間に別のプロセスが更新しているかもしれないので読み直す
      const latest = (await this.#o.store.load()) ?? current;
      if (!this.#needsRefresh(latest)) return this.#remember(latest);

      let result: ReissueResult;
      try {
        result = await this.#o.reissue(latest);
      } catch (error) {
        if (
          error instanceof KintaiApiError &&
          (error.kind === 'auth' || error.kind === 'forbidden')
        ) {
          throw new TokenExpiredError();
        }
        this.#warn(`Token refresh failed (${describe(error)}); will retry later.`);
        return this.#fallback(latest);
      }

      const updated: Credentials = {
        ...latest,
        token: result.token,
        expiresAt: result.expiresAt.toISOString(),
        updatedAt: this.#o.now().toISOString(),
        ...(result.staffId === undefined ? {} : { staffId: result.staffId }),
      };
      await this.#o.store.save(updated);
      return this.#remember(updated);
    } finally {
      await release();
    }
  }

  #fallback(credentials: Credentials): Credentials {
    this.#nextRefreshAttempt = this.#o.now().getTime() + this.#o.retryAfterFailureMs;
    return this.#remember(credentials);
  }

  #remember(credentials: Credentials): Credentials {
    this.#cache = { credentials, loadedAt: this.#o.now().getTime() };
    return credentials;
  }

  #warn(message: string): void {
    this.#o.warn(message);
  }
}

function describe(error: unknown): string {
  if (error instanceof KintaiApiError) return error.kind;
  return error instanceof Error ? error.name : 'unknown error';
}
