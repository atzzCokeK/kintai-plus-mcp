import { describe, expect, it } from 'vitest';
import { FileCredentialStore } from '../../src/credentials/file-store.ts';
import { importFromEnv, selectCredentialStore } from '../../src/credentials/select.ts';
import type { CredentialStore, Credentials } from '../../src/credentials/types.ts';

function fakeKeychain(available: boolean) {
  return { probe: async () => available, kind: 'keychain' as const } as never;
}

describe('selectCredentialStore', () => {
  it('キーチェーンが使えればキーチェーン', async () => {
    const store = await selectCredentialStore({ env: {}, keychain: fakeKeychain(true) });
    expect(store.kind).toBe('keychain');
  });

  it('使えなければファイル（既定パス）に切り替え、理由をログに出す', async () => {
    const logs: string[] = [];
    const store = await selectCredentialStore({
      env: { XDG_CONFIG_HOME: '/cfg' },
      keychain: fakeKeychain(false),
      log: (m) => logs.push(m),
    });
    expect(store).toBeInstanceOf(FileCredentialStore);
    expect(store.location).toBe('/cfg/kintai-plus-mcp/credentials.json');
    expect(logs.join('')).toMatch(/keychain/i);
  });

  it('KINTAI_PLUS_CREDENTIAL_STORE=file ならキーチェーンを見ない', async () => {
    const store = await selectCredentialStore({
      env: { KINTAI_PLUS_CREDENTIAL_STORE: 'file' },
      keychain: fakeKeychain(true),
    });
    expect(store.kind).toBe('file');
  });

  it('ファイルのパスを環境変数で指定したらファイルを使う', async () => {
    const store = await selectCredentialStore({
      env: { KINTAI_PLUS_CREDENTIALS_FILE: '/x/creds.json' },
      keychain: fakeKeychain(true),
    });
    expect(store.location).toBe('/x/creds.json');
  });

  it('keychain を明示したのに使えなければエラー', async () => {
    await expect(
      selectCredentialStore({
        env: { KINTAI_PLUS_CREDENTIAL_STORE: 'keychain' },
        keychain: fakeKeychain(false),
      }),
    ).rejects.toThrow(/keychain/i);
  });

  it('不正な指定はエラー', async () => {
    await expect(
      selectCredentialStore({
        env: { KINTAI_PLUS_CREDENTIAL_STORE: 'cloud' },
        keychain: fakeKeychain(true),
      }),
    ).rejects.toThrow(/KINTAI_PLUS_CREDENTIAL_STORE/);
  });
});

function memoryStore(initial?: Credentials): CredentialStore & { saved: Credentials[] } {
  let value = initial;
  const saved: Credentials[] = [];
  return {
    kind: 'file',
    location: 'memory',
    saved,
    load: async () => value,
    save: async (c) => {
      value = c;
      saved.push(c);
    },
    clear: async () => {
      const had = value !== undefined;
      value = undefined;
      return had;
    },
  };
}

const NOW = new Date('2026-10-27T00:00:00Z');

describe('importFromEnv', () => {
  const env = {
    KINTAI_PLUS_TOKEN: 'env-token-123456',
    KINTAI_PLUS_COMPANY_ID: 'acme',
    KINTAI_PLUS_HOST: 'https://atnd-awj.ak4.jp/',
  };

  it('保存先が空でも、既定では環境変数のトークンを保存しない', async () => {
    const store = memoryStore();
    const result = await importFromEnv(store, env, NOW);
    expect(result).toEqual({
      version: 1,
      host: 'atnd-awj.ak4.jp',
      companyId: 'acme',
      token: 'env-token-123456',
      updatedAt: NOW.toISOString(),
    });
    expect(store.saved).toHaveLength(0);
  });

  it('KINTAI_PLUS_PERSIST_ENV_TOKEN に相当する persist のときだけ保存する', async () => {
    const store = memoryStore();
    await importFromEnv(store, env, NOW, { persist: true });
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]?.token).toBe('env-token-123456');
  });

  it('接続先を省略したら atnd.ak4.jp', async () => {
    const store = memoryStore();
    const { KINTAI_PLUS_HOST: _h, ...rest } = env;
    expect((await importFromEnv(store, rest, NOW))?.host).toBe('atnd.ak4.jp');
  });

  it('保存先に既にあれば、環境変数は無視して保存先を正とする', async () => {
    const existing: Credentials = {
      version: 1,
      host: 'atnd.ak4.jp',
      companyId: 'acme',
      token: 'stored-token-999',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    const store = memoryStore(existing);
    expect(await importFromEnv(store, env, NOW)).toEqual(existing);
    expect(store.saved).toHaveLength(0);
  });

  it('環境変数が足りなければ何もしない', async () => {
    const store = memoryStore();
    expect(await importFromEnv(store, { KINTAI_PLUS_TOKEN: 'x' }, NOW)).toBeUndefined();
    expect(store.saved).toHaveLength(0);
  });

  it('不正な接続先・企業 ID はエラー（トークンは出さない）', async () => {
    const store = memoryStore();
    const bad = { ...env, KINTAI_PLUS_HOST: 'evil.example.com' };
    await expect(importFromEnv(store, bad, NOW)).rejects.toThrow(/KINTAI_PLUS_HOST/);
    await expect(
      importFromEnv(store, { ...env, KINTAI_PLUS_COMPANY_ID: 'a/b' }, NOW),
    ).rejects.toThrow(/KINTAI_PLUS_COMPANY_ID/);
  });
});
