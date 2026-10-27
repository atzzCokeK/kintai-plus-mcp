import { AsyncEntry, type EntryOptions } from '@napi-rs/keyring';
import {
  type CredentialStore,
  type Credentials,
  parseCredentials,
  serializeCredentials,
} from './types.ts';

export const KEYCHAIN_SERVICE = 'kintai-plus-mcp';
const ACCOUNT = 'default';

/**
 * Linux では Secret Service を明示する。未指定だと、Secret Service がないときに
 * 再起動で消えるカーネルのキーリング（keyutils）へ黙って切り替わるため。
 * 他の OS ではこのオプションは無視される。
 */
const ENTRY_OPTIONS: EntryOptions = { linux: { store: 'secret-service' } };

export interface KeychainEntry {
  getPassword(): Promise<string | null>;
  setPassword(password: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}

export type CreateEntry = (
  service: string,
  account: string,
  options: EntryOptions,
) => KeychainEntry;

const defaultCreateEntry: CreateEntry = (service, account, options) =>
  new AsyncEntry(service, account, options);

export interface KeychainStoreOptions {
  createEntry?: CreateEntry;
}

/** OS のキーチェーン（macOS Keychain / Windows 資格情報マネージャー / Secret Service）に保存する。 */
export class KeychainCredentialStore implements CredentialStore {
  readonly kind = 'keychain' as const;
  readonly location = `OS keychain (service: ${KEYCHAIN_SERVICE})`;
  readonly #createEntry: CreateEntry;
  #entry: KeychainEntry | undefined;

  constructor(options: KeychainStoreOptions = {}) {
    this.#createEntry = options.createEntry ?? defaultCreateEntry;
    try {
      this.#entry = this.#createEntry(KEYCHAIN_SERVICE, ACCOUNT, ENTRY_OPTIONS);
    } catch {
      // 使えるかどうかは probe() で判定する
      this.#entry = undefined;
    }
  }

  /** キーチェーンが実際に使えるかを読み取りで確かめる（コンストラクタは成功しても読み書きで失敗することがある）。 */
  async probe(): Promise<boolean> {
    if (!this.#entry) return false;
    try {
      await this.#entry.getPassword();
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<Credentials | undefined> {
    const value = await this.#require().getPassword();
    return value === null ? undefined : parseCredentials(value);
  }

  async save(credentials: Credentials): Promise<void> {
    await this.#require().setPassword(serializeCredentials(credentials));
  }

  async clear(): Promise<boolean> {
    return this.#require().deletePassword();
  }

  #require(): KeychainEntry {
    if (!this.#entry) throw new Error('OS keychain is not available');
    return this.#entry;
  }
}
