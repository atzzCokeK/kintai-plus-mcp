import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type CredentialStore,
  type Credentials,
  parseCredentials,
  serializeCredentials,
} from './types.ts';

export const CREDENTIALS_FILE_ENV = 'KINTAI_PLUS_CREDENTIALS_FILE';
const APP_DIR = 'kintai-plus-mcp';
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const isPosix = process.platform !== 'win32';

type Env = Record<string, string | undefined>;

export function defaultCredentialsPath(env: Env = process.env, home: string = homedir()): string {
  const override = env[CREDENTIALS_FILE_ENV];
  if (override) return override;
  const configHome = env.XDG_CONFIG_HOME || join(home, '.config');
  return join(configHome, APP_DIR, 'credentials.json');
}

export interface FileStoreOptions {
  warn?: (message: string) => void;
}

/** 本人だけが読み書きできるファイル（600）に保存する。キーチェーンが使えない環境向け。 */
export class FileCredentialStore implements CredentialStore {
  readonly kind = 'file' as const;
  readonly location: string;
  readonly #warn: (message: string) => void;

  constructor(path: string, options: FileStoreOptions = {}) {
    this.location = path;
    this.#warn = options.warn ?? (() => {});
  }

  async load(): Promise<Credentials | undefined> {
    let text: string;
    try {
      await this.#tightenPermissions();
      text = await readFile(this.location, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    return parseCredentials(text);
  }

  async save(credentials: Credentials): Promise<void> {
    const dir = dirname(this.location);
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
    // 書きかけのファイルを読まれないよう、一時ファイルに書いてから置き換える
    const tmp = `${this.location}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, serializeCredentials(credentials), { mode: FILE_MODE, flag: 'wx' });
      if (isPosix) await chmod(tmp, FILE_MODE);
      await rename(tmp, this.location);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }

  async clear(): Promise<boolean> {
    try {
      await rm(this.location);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async #tightenPermissions(): Promise<void> {
    if (!isPosix) return;
    const { mode } = await stat(this.location);
    if ((mode & 0o077) !== 0) {
      this.#warn(
        `Credentials file ${this.location} had loose permissions (${(mode & 0o777).toString(8)}); changed to 600.`,
      );
      await chmod(this.location, FILE_MODE);
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}
