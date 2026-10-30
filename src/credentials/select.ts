import { isValidCompanyId, parseApiHost } from '../api/endpoint.ts';
import { CREDENTIALS_FILE_ENV, defaultCredentialsPath, FileCredentialStore } from './file-store.ts';
import { KeychainCredentialStore } from './keychain-store.ts';
import type { CredentialStore, Credentials } from './types.ts';

type Env = Record<string, string | undefined>;

export const STORE_ENV = 'KINTAI_PLUS_CREDENTIAL_STORE';
export const TOKEN_ENV = 'KINTAI_PLUS_TOKEN';
export const COMPANY_ID_ENV = 'KINTAI_PLUS_COMPANY_ID';
export const HOST_ENV = 'KINTAI_PLUS_HOST';

export interface SelectStoreOptions {
  env?: Env;
  keychain?: Pick<KeychainCredentialStore, 'probe'> & CredentialStore;
  log?: (message: string) => void;
}

/**
 * 保存先を選ぶ。既定（auto）はキーチェーン → 使えなければファイル。
 * `KINTAI_PLUS_CREDENTIAL_STORE=keychain|file` で固定でき、
 * `KINTAI_PLUS_CREDENTIALS_FILE` を指定した場合はファイルを使う。
 */
export async function selectCredentialStore(
  options: SelectStoreOptions = {},
): Promise<CredentialStore> {
  const env = options.env ?? process.env;
  const log = options.log ?? (() => {});
  const mode = (env[STORE_ENV] ?? 'auto').trim().toLowerCase() || 'auto';
  if (mode !== 'auto' && mode !== 'keychain' && mode !== 'file') {
    throw new Error(`${STORE_ENV} must be one of: auto, keychain, file`);
  }

  const file = () => new FileCredentialStore(defaultCredentialsPath(env), { warn: log });
  if (mode === 'file' || (mode === 'auto' && env[CREDENTIALS_FILE_ENV])) return file();

  const keychain = options.keychain ?? new KeychainCredentialStore();
  if (await keychain.probe()) return keychain;
  if (mode === 'keychain') {
    throw new Error(
      `OS keychain is not available, but ${STORE_ENV}=keychain is set. ` +
        'On Linux, a Secret Service provider (e.g. GNOME Keyring) must be running.',
    );
  }
  const fallback = file();
  log(`OS keychain is not available; storing credentials in ${fallback.location} (mode 600).`);
  return fallback;
}

export interface ImportFromEnvOptions {
  /**
   * true のときだけ保存先へ書く。既定は false。
   * 環境変数のトークンを再発行すると、その値が使えなくなるため、明示したときだけ引き取る。
   */
  persist?: boolean;
}

/**
 * 保存先が空のとき、環境変数から認証情報を読む。
 * 既定では保存しない。`persist: true` のときだけ保存し、以降は保存先を正とする。
 * 保存先に既にあれば、環境変数は無視して保存先を返す。
 */
export async function importFromEnv(
  store: CredentialStore,
  env: Env = process.env,
  now: Date = new Date(),
  options: ImportFromEnvOptions = {},
): Promise<Credentials | undefined> {
  const existing = await store.load();
  if (existing) return existing;

  const token = env[TOKEN_ENV]?.trim();
  const companyId = env[COMPANY_ID_ENV]?.trim();
  if (!token || !companyId) return undefined;

  const hostInput = env[HOST_ENV]?.trim() || 'atnd.ak4.jp';
  const host = parseApiHost(hostInput);
  if (!host) throw new Error(`${HOST_ENV} must be atnd.ak4.jp or atnd-awj.ak4.jp`);
  if (!isValidCompanyId(companyId)) throw new Error(`${COMPANY_ID_ENV} is not a valid company ID`);

  const credentials: Credentials = {
    version: 1,
    host,
    companyId,
    token,
    updatedAt: now.toISOString(),
  };
  if (options.persist) await store.save(credentials);
  return credentials;
}

/**
 * 保存先が空のあいだ、環境変数のトークンをメモリ上だけで返す。
 * 保存先に認証情報が入ったあと（login など）は保存先を読む。書き出しは保存先に既にあるときだけ。
 */
export class EnvFallbackStore implements CredentialStore {
  readonly #inner: CredentialStore;
  #fallback: Credentials | undefined;

  constructor(inner: CredentialStore, fallback: Credentials) {
    this.#inner = inner;
    this.#fallback = fallback;
  }

  get kind() {
    return this.#inner.kind;
  }

  get location() {
    return this.#inner.location;
  }

  async load(): Promise<Credentials | undefined> {
    return (await this.#inner.load()) ?? this.#fallback;
  }

  async save(credentials: Credentials): Promise<void> {
    if (await this.#inner.load()) {
      await this.#inner.save(credentials);
      return;
    }
    this.#fallback = credentials;
  }

  async clear(): Promise<boolean> {
    this.#fallback = undefined;
    return this.#inner.clear();
  }
}
