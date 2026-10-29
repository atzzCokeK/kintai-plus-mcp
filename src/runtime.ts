import { dirname, join } from 'node:path';
import { KintaiApiClient, type RecordedResponse } from './api/client.ts';
import type { Connection } from './api/endpoint.ts';
import { RequestThrottle } from './api/throttle.ts';
import { reissueToken } from './api/token.ts';
import { type Config, loadConfig } from './config.ts';
import { defaultCredentialsPath } from './credentials/file-store.ts';
import type { KeychainCredentialStore } from './credentials/keychain-store.ts';
import { acquireFileLock } from './credentials/lock.ts';
import { EnvFallbackStore, importFromEnv, selectCredentialStore } from './credentials/select.ts';
import { TokenManager } from './credentials/token-manager.ts';
import {
  type CredentialStore,
  type Credentials,
  CredentialsFormatError,
} from './credentials/types.ts';
import { createLogger, type Logger } from './log.ts';

type Env = Record<string, string | undefined>;

export interface RuntimeOptions {
  env?: Env;
  fetch?: typeof fetch;
  now?: () => Date;
  writeLog?: (line: string) => void;
  keychain?: KeychainCredentialStore;
  /** 手元の E2E で応答を記録する */
  onResponse?: (response: RecordedResponse) => void;
}

export interface Runtime {
  config: Config;
  logger: Logger;
  store: CredentialStore;
  tokens: TokenManager;
  /** 保存済みの接続先で API クライアントを作る（未ログインなら NotLoggedInError） */
  getClient(): Promise<KintaiApiClient>;
  /** 任意の接続先・トークンで API クライアントを作る（login の疎通確認用） */
  createClient(connection: Connection, getToken: () => Promise<string>): KintaiApiClient;
  /** 環境変数のトークンを、保存も再発行もせずに使っている */
  usingEnvToken: boolean;
}

/** 設定・ログ・保存先・トークン管理・API クライアントを組み立てる。 */
export async function createRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
  const env = options.env ?? process.env;
  const config = loadConfig(env);
  const logger = createLogger({
    level: config.logLevel,
    ...(options.writeLog ? { write: options.writeLog } : {}),
  });
  const store = await selectCredentialStore({
    env,
    log: (m) => logger.warn(m),
    ...(options.keychain ? { keychain: options.keychain } : {}),
  });

  // 1 プロセスで 1 つのスロットリングを共有する
  const throttle = new RequestThrottle({ minIntervalMs: config.minIntervalMs });
  const createClient = (connection: Connection, getToken: () => Promise<string>) =>
    new KintaiApiClient({
      connection,
      getToken,
      throttle,
      logger,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.onResponse ? { onResponse: options.onResponse } : {}),
    });

  const lockPath = join(dirname(defaultCredentialsPath(env)), 'refresh.lock');
  let tokenStore: CredentialStore = store;
  let usingEnvToken = false;
  try {
    const before = await store.load();
    const imported = await importFromEnv(store, env, options.now?.() ?? new Date(), {
      persist: config.persistEnvToken,
    });
    if (imported) logger.addSecret(imported.token);
    if (!before && imported && !config.persistEnvToken) {
      usingEnvToken = true;
      tokenStore = new EnvFallbackStore(store, imported);
    }
  } catch (error) {
    // 壊れた保存データがあっても login で上書きできるよう、ここでは止めない
    if (!(error instanceof CredentialsFormatError)) throw error;
    logger.warn(error.message);
  }

  const tokens = new TokenManager({
    store: tokenStore,
    refreshBeforeDays: config.refreshBeforeDays,
    autoRefresh: config.autoRefresh,
    // 環境変数のトークンは再発行しない。再発行すると、環境変数に残した値が使えなくなる
    reissueUnknownExpiry: !usingEnvToken,
    warn: (m) => logger.warn(m),
    acquireLock: () => acquireFileLock(lockPath),
    reissue: async (credentials: Credentials) => {
      logger.addSecret(credentials.token);
      const result = await reissueToken(
        createClient(toConnection(credentials), async () => credentials.token),
        credentials.token,
      );
      logger.addSecret(result.token);
      logger.info(`API token refreshed; new expiry ${result.expiresAt.toISOString()}`);
      return result;
    },
    ...(options.now ? { now: options.now } : {}),
  });

  return {
    config,
    logger,
    store,
    tokens,
    usingEnvToken,
    createClient,
    async getClient() {
      const credentials = await tokens.getCredentials();
      return createClient(toConnection(credentials), () => tokens.getToken());
    },
  };
}

export function toConnection(credentials: Credentials): Connection {
  return { host: credentials.host, companyId: credentials.companyId };
}
