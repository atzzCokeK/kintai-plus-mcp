import { mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export class LockTimeoutError extends Error {
  override readonly name = 'LockTimeoutError';
}

export interface LockOptions {
  /** 取得を諦めるまでの時間（既定 15 秒） */
  timeoutMs?: number;
  /** この時間より古いロックは、持ち主が落ちたとみなして奪う（既定 60 秒） */
  staleMs?: number;
  retryIntervalMs?: number;
}

export type ReleaseLock = () => Promise<void>;

/**
 * 排他作成（O_EXCL）によるプロセス間ロック。トークンの二重更新を防ぐために使う。
 * 戻り値の関数を呼ぶと解放する。
 */
export async function acquireFileLock(
  path: string,
  options: LockOptions = {},
): Promise<ReleaseLock> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const staleMs = options.staleMs ?? 60_000;
  const retryIntervalMs = options.retryIntervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
      await handle.close();
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await rm(path, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    if (await isStale(path, staleMs)) {
      await rm(path, { force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      throw new LockTimeoutError(`Timed out waiting for lock ${path}`);
    }
    await delay(retryIntervalMs);
  }
}

async function isStale(path: string, staleMs: number): Promise<boolean> {
  try {
    const { mtimeMs } = await stat(path);
    return Date.now() - mtimeMs > staleMs;
  } catch {
    return false; // 消えていれば次の試行で取れる
  }
}
