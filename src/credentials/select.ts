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

/**
 * 保存先が空のときだけ、環境変数から認証情報を取り込む。以降は保存先を正とする。
 * 戻り値は保存先にある（または取り込んだ）認証情報。どちらもなければ undefined。
 */
export async function importFromEnv(
  store: CredentialStore,
  env: Env = process.env,
  now: Date = new Date(),
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
  await store.save(credentials);
  return credentials;
}
