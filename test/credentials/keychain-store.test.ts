import { describe, expect, it } from 'vitest';
import {
  KEYCHAIN_SERVICE,
  KeychainCredentialStore,
  type KeychainEntry,
} from '../../src/credentials/keychain-store.ts';
import type { Credentials } from '../../src/credentials/types.ts';

const creds: Credentials = {
  version: 1,
  host: 'atnd-awj.ak4.jp',
  companyId: 'acme',
  token: 'secret-token-abc',
  updatedAt: '2026-10-27T00:00:00.000Z',
};

function memoryEntry(): KeychainEntry & { value: string | null } {
  return {
    value: null,
    async getPassword() {
      return this.value;
    },
    async setPassword(v: string) {
      this.value = v;
    },
    async deletePassword() {
      const had = this.value !== null;
      this.value = null;
      return had;
    },
  };
}

describe('KeychainCredentialStore', () => {
  it('JSON にしてキーチェーンに保存し、読み戻せる', async () => {
    const entry = memoryEntry();
    const store = new KeychainCredentialStore({ createEntry: () => entry });
    expect(await store.load()).toBeUndefined();
    await store.save(creds);
    expect(JSON.parse(entry.value ?? '')).toEqual(creds);
    expect(await store.load()).toEqual(creds);
    expect(await store.clear()).toBe(true);
    expect(await store.clear()).toBe(false);
  });

  it('サービス名・アカウント名を指定して作る。Linux では Secret Service を明示する', () => {
    const args: unknown[] = [];
    new KeychainCredentialStore({
      createEntry: (...a) => {
        args.push(...a);
        return memoryEntry();
      },
    });
    expect(args[0]).toBe(KEYCHAIN_SERVICE);
    expect(args[1]).toBe('default');
    expect(args[2]).toEqual({ linux: { store: 'secret-service' } });
  });

  it('location にサービス名を出す（トークンは出さない）', () => {
    const store = new KeychainCredentialStore({ createEntry: () => memoryEntry() });
    expect(store.kind).toBe('keychain');
    expect(store.location).toContain(KEYCHAIN_SERVICE);
  });

  it('probe: 読めれば true、例外なら false', async () => {
    const ok = new KeychainCredentialStore({ createEntry: () => memoryEntry() });
    expect(await ok.probe()).toBe(true);
    const broken = new KeychainCredentialStore({
      createEntry: () => ({
        getPassword: async () => {
          throw new Error('DBus error');
        },
        setPassword: async () => {},
        deletePassword: async () => false,
      }),
    });
    expect(await broken.probe()).toBe(false);
    const ctorThrows = new KeychainCredentialStore({
      createEntry: () => {
        throw new Error('no backend');
      },
    });
    expect(await ctorThrows.probe()).toBe(false);
  });
});
