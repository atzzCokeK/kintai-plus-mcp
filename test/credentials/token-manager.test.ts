import { describe, expect, it } from 'vitest';
import { KintaiApiError } from '../../src/api/errors.ts';
import {
  NotLoggedInError,
  TokenExpiredError,
  TokenManager,
  type TokenManagerOptions,
} from '../../src/credentials/token-manager.ts';
import type { CredentialStore, Credentials } from '../../src/credentials/types.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-27T00:00:00Z');

function base(overrides: Partial<Credentials> = {}): Credentials {
  return {
    version: 1,
    host: 'atnd.ak4.jp',
    companyId: 'acme',
    token: 'token-old-000000',
    expiresAt: new Date(NOW.getTime() + 20 * DAY).toISOString(),
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function memoryStore(initial?: Credentials) {
  let value = initial;
  const store: CredentialStore & {
    saves: Credentials[];
    loads: number;
    set(c: Credentials): void;
  } = {
    kind: 'file',
    location: 'memory',
    saves: [],
    loads: 0,
    set(c) {
      value = c;
    },
    async load() {
      store.loads++;
      return value;
    },
    async save(c) {
      value = c;
      store.saves.push(c);
    },
    async clear() {
      value = undefined;
      return true;
    },
  };
  return store;
}

function setup(initial: Credentials | undefined, opts: Partial<TokenManagerOptions> = {}) {
  const store = memoryStore(initial);
  const reissued: string[] = [];
  const warnings: string[] = [];
  let lockCount = 0;
  let now = NOW;
  const manager = new TokenManager({
    store,
    now: () => now,
    reissue: async (creds) => {
      reissued.push(creds.token);
      return {
        token: `token-new-${reissued.length}-xxxx`,
        expiresAt: new Date(now.getTime() + 32 * DAY),
        staffId: 42,
      };
    },
    acquireLock: async () => {
      lockCount++;
      return async () => {};
    },
    warn: (m) => warnings.push(m),
    ...opts,
  });
  return {
    store,
    manager,
    reissued,
    warnings,
    locks: () => lockCount,
    setNow: (d: Date) => {
      now = d;
    },
  };
}

describe('TokenManager', () => {
  it('残りが 15 日より多ければそのまま使う', async () => {
    const { manager, reissued } = setup(base());
    expect(await manager.getToken()).toBe('token-old-000000');
    expect(reissued).toEqual([]);
  });

  it('残りが 15 日以下なら再発行して保存し、新しいトークンを返す', async () => {
    const { manager, reissued, store, locks } = setup(
      base({ expiresAt: new Date(NOW.getTime() + 15 * DAY).toISOString() }),
    );
    expect(await manager.getToken()).toBe('token-new-1-xxxx');
    expect(reissued).toEqual(['token-old-000000']);
    expect(locks()).toBe(1);
    expect(store.saves[0]).toMatchObject({
      token: 'token-new-1-xxxx',
      staffId: 42,
      expiresAt: new Date(NOW.getTime() + 32 * DAY).toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it('しきい値の日数は変更できる', async () => {
    const { manager, reissued } = setup(base(), { refreshBeforeDays: 25 });
    await manager.getToken();
    expect(reissued).toHaveLength(1);
  });

  it('有効期限が不明なら再発行して期限を確定する', async () => {
    const { manager, reissued } = setup(base({ expiresAt: undefined }));
    expect(await manager.getToken()).toBe('token-new-1-xxxx');
    expect(reissued).toHaveLength(1);
  });

  it('ロック取得後に保存先を読み直し、他のプロセスが更新済みなら再発行しない', async () => {
    const { manager, reissued, store } = setup(
      base({ expiresAt: new Date(NOW.getTime() + 3 * DAY).toISOString() }),
      {
        acquireLock: async () => {
          // ロックを待っている間に別プロセスが更新した
          store.set(
            base({
              token: 'token-by-other-proc',
              expiresAt: new Date(NOW.getTime() + 32 * DAY).toISOString(),
            }),
          );
          return async () => {};
        },
      },
    );
    expect(await manager.getToken()).toBe('token-by-other-proc');
    expect(reissued).toEqual([]);
  });

  it('自動更新を無効にできる', async () => {
    const { manager, reissued } = setup(
      base({ expiresAt: new Date(NOW.getTime() + 3 * DAY).toISOString() }),
      { autoRefresh: false },
    );
    expect(await manager.getToken()).toBe('token-old-000000');
    expect(reissued).toEqual([]);
  });

  it('未ログインなら login の案内付きのエラー', async () => {
    const { manager } = setup(undefined);
    await expect(manager.getToken()).rejects.toThrow(NotLoggedInError);
    await expect(manager.getToken()).rejects.toThrow(/npx kintai-plus-mcp login/);
  });

  it('期限切れなら、マイページでの再発行と login を案内する', async () => {
    const { manager } = setup(base({ expiresAt: new Date(NOW.getTime() - DAY).toISOString() }), {
      reissue: async () => {
        throw new KintaiApiError({ kind: 'auth', message: 'expired' });
      },
    });
    const err = await manager.getToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TokenExpiredError);
    expect(String(err)).toMatch(/マイページ/);
    expect(String(err)).toMatch(/login/);
    expect(String(err)).not.toContain('token-old-000000');
  });

  it('再発行が認証エラーなら失効とみなす', async () => {
    const { manager } = setup(
      base({ expiresAt: new Date(NOW.getTime() + 3 * DAY).toISOString() }),
      {
        reissue: async () => {
          throw new KintaiApiError({ kind: 'auth', message: 'invalid' });
        },
      },
    );
    await expect(manager.getToken()).rejects.toThrow(TokenExpiredError);
  });

  it('再発行が通信エラーなら、期限内のトークンをそのまま使い、しばらく再試行しない', async () => {
    let calls = 0;
    const { manager, warnings, setNow } = setup(
      base({ expiresAt: new Date(NOW.getTime() + 3 * DAY).toISOString() }),
      {
        reissue: async () => {
          calls++;
          throw new KintaiApiError({ kind: 'network', message: 'down' });
        },
      },
    );
    expect(await manager.getToken()).toBe('token-old-000000');
    expect(await manager.getToken()).toBe('token-old-000000');
    expect(calls).toBe(1);
    expect(warnings.join('')).toMatch(/refresh/i);
    setNow(new Date(NOW.getTime() + 10 * 60_000));
    await manager.getToken();
    expect(calls).toBe(2);
  });

  it('ロックが取れなくても期限内なら今のトークンで続ける', async () => {
    const { manager, reissued } = setup(
      base({ expiresAt: new Date(NOW.getTime() + 3 * DAY).toISOString() }),
      {
        acquireLock: async () => {
          throw new Error('lock timeout');
        },
      },
    );
    expect(await manager.getToken()).toBe('token-old-000000');
    expect(reissued).toEqual([]);
  });

  it('getCredentials は接続先と企業 ID を返す', async () => {
    const { manager } = setup(base());
    expect(await manager.getCredentials()).toMatchObject({
      host: 'atnd.ak4.jp',
      companyId: 'acme',
    });
  });

  it('同時に呼ばれても再発行は 1 回だけ', async () => {
    const { manager, reissued } = setup(
      base({ expiresAt: new Date(NOW.getTime() + 3 * DAY).toISOString() }),
    );
    const tokens = await Promise.all([manager.getToken(), manager.getToken(), manager.getToken()]);
    expect(new Set(tokens)).toEqual(new Set(['token-new-1-xxxx']));
    expect(reissued).toHaveLength(1);
  });

  it('invalidate すると次回は保存先を読み直す', async () => {
    const { manager, store } = setup(base());
    await manager.getToken();
    await manager.getToken();
    const before = store.loads;
    store.set(base({ token: 'token-replaced-1234' }));
    manager.invalidate();
    expect(await manager.getToken()).toBe('token-replaced-1234');
    expect(store.loads).toBe(before + 1);
  });
});
