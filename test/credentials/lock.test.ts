import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireFileLock, LockTimeoutError } from '../../src/credentials/lock.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kintai-plus-mcp-lock-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('acquireFileLock', () => {
  it('取得するとロックファイルができ、解放で消える', async () => {
    const path = join(dir, 'sub', 'refresh.lock');
    const release = await acquireFileLock(path);
    await expect(stat(path)).resolves.toBeTruthy();
    await release();
    await expect(stat(path)).rejects.toThrow();
  });

  it('他が持っている間は待ち、解放されたら取得する', async () => {
    const path = join(dir, 'refresh.lock');
    const order: string[] = [];
    const release1 = await acquireFileLock(path);
    const second = acquireFileLock(path, { retryIntervalMs: 5 }).then((release) => {
      order.push('second acquired');
      return release;
    });
    await new Promise((r) => setTimeout(r, 30));
    order.push('first releasing');
    await release1();
    const release2 = await second;
    expect(order).toEqual(['first releasing', 'second acquired']);
    await release2();
  });

  it('時間内に取れなければ LockTimeoutError', async () => {
    const path = join(dir, 'refresh.lock');
    const release = await acquireFileLock(path);
    await expect(acquireFileLock(path, { timeoutMs: 40, retryIntervalMs: 5 })).rejects.toThrow(
      LockTimeoutError,
    );
    await release();
  });

  it('古いロック（プロセスが落ちて残ったもの）は奪う', async () => {
    const path = join(dir, 'refresh.lock');
    await writeFile(path, 'stale');
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(path, old, old);
    const release = await acquireFileLock(path, { staleMs: 60_000, timeoutMs: 100 });
    await release();
  });

  it('解放を 2 回呼んでもエラーにならない', async () => {
    const release = await acquireFileLock(join(dir, 'refresh.lock'));
    await release();
    await expect(release()).resolves.toBeUndefined();
  });
});
