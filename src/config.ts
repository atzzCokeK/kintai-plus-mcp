import {
  CONFIRM_LEVELS,
  type ConfirmLevel,
  DEFAULT_CONFIRM_LEVEL,
  isConfirmLevel,
} from './confirm.ts';
import type { LogLevel } from './log.ts';

type Env = Record<string, string | undefined>;

export interface Config {
  /** 有効期限の残りがこの日数以下になったらトークンを再発行する */
  refreshBeforeDays: number;
  autoRefresh: boolean;
  /** 書き込みツールを公開しない */
  readOnly: boolean;
  /** 書き込み前の確認。環境変数 > login で保存した値 > 既定（削除だけ） */
  confirm: ConfirmLevel;
  /** confirm をどこで決めたか */
  confirmSource: 'env' | 'settings' | 'default';
  /** 打刻の緯度・経度・IP を返り値に含める */
  includeLocation: boolean;
  logLevel: LogLevel;
  /** API リクエストの最小間隔（ミリ秒） */
  minIntervalMs: number;
  /**
   * 環境変数のトークンを保存し、期限が不明なら再発行する。
   * 既定は false（そのプロセスの中だけで使い、再発行しない）。
   */
  persistEnvToken: boolean;
}

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

export function loadConfig(env: Env = process.env): Config {
  return {
    refreshBeforeDays: int(env, 'KINTAI_PLUS_REFRESH_DAYS', 15, 1, 30),
    autoRefresh: bool(env, 'KINTAI_PLUS_AUTO_REFRESH', true),
    readOnly: bool(env, 'KINTAI_PLUS_READ_ONLY', false),
    ...resolveConfirm(env),
    includeLocation: bool(env, 'KINTAI_PLUS_INCLUDE_LOCATION', false),
    logLevel: oneOf(env, 'KINTAI_PLUS_LOG_LEVEL', LOG_LEVELS, 'info'),
    minIntervalMs: int(env, 'KINTAI_PLUS_MIN_INTERVAL_MS', 300, 100, 60_000),
    persistEnvToken: bool(env, 'KINTAI_PLUS_PERSIST_ENV_TOKEN', false),
  };
}

/**
 * 確認レベルを決める。
 * 1. KINTAI_PLUS_CONFIRM（always / destructive / never）
 * 2. KINTAI_PLUS_CONFIRM_WRITES（true は always、false は never）
 * 3. 旧名 CONFIRM_WRITES（新しい名前がどちらも無いとき）
 * 4. login で保存した値
 * 5. 既定は destructive（削除だけ確認）
 */
export function resolveConfirm(
  env: Env,
  saved?: ConfirmLevel,
): { confirm: ConfirmLevel; confirmSource: 'env' | 'settings' | 'default' } {
  const named = read(env, 'KINTAI_PLUS_CONFIRM');
  if (named !== undefined) {
    const level = named.toLowerCase();
    if (!isConfirmLevel(level)) {
      throw new Error(`KINTAI_PLUS_CONFIRM must be one of: ${CONFIRM_LEVELS.join(', ')}`);
    }
    return { confirm: level, confirmSource: 'env' };
  }
  if (read(env, 'KINTAI_PLUS_CONFIRM_WRITES') !== undefined) {
    return {
      confirm: bool(env, 'KINTAI_PLUS_CONFIRM_WRITES', false) ? 'always' : 'never',
      confirmSource: 'env',
    };
  }
  if (read(env, 'CONFIRM_WRITES') !== undefined) {
    return {
      confirm: bool(env, 'CONFIRM_WRITES', false) ? 'always' : 'never',
      confirmSource: 'env',
    };
  }
  if (saved !== undefined) return { confirm: saved, confirmSource: 'settings' };
  return { confirm: DEFAULT_CONFIRM_LEVEL, confirmSource: 'default' };
}

function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === '' ? undefined : value;
}

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
  const raw = read(env, name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`${name} must be true or false`);
}

function oneOf<T extends string>(env: Env, name: string, values: readonly T[], fallback: T): T {
  const raw = read(env, name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (!(values as readonly string[]).includes(raw)) {
    throw new Error(`${name} must be one of: ${values.join(', ')}`);
  }
  return raw as T;
}
