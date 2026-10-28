import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultCredentialsPath, FileCredentialStore } from '../../src/credentials/file-store.ts';
import type { Credentials } from '../../src/credentials/types.ts';

const creds: Credentials = {
  version: 1,
  host: 'atnd.ak4.jp',
  companyId: 'acme',
  token: 'secret-token-abc',
  updatedAt: '2026-10-27T00:00:00.000Z',
};

const isPosix = process.platform !== 'win32';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kintai-plus-mcp-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileCredentialStore', () => {
  it('無ければ undefined', async () => {
    const store = new FileCredentialStore(join(dir, 'nested', 'credentials.json'));
    expect(await store.load()).toBeUndefined();
    expect(store.kind).toBe('file');
  });

  it('保存して読める。ディレクトリも作る', async () => {
    const path = join(dir, 'nested', 'credentials.json');
    const store = new FileCredentialStore(path);
    await store.save(creds);
    expect(await store.load()).toEqual(creds);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(creds);
  });

  it.runIf(isPosix)('ファイルは 600、作ったディレクトリは 700', async () => {
    const path = join(dir, 'nested', 'credentials.json');
    await new FileCredentialStore(path).save(creds);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'nested'))).mode & 0o777).toBe(0o700);
  });

  it.runIf(isPosix)('既存ファイルの権限が緩ければ 600 に直してから読む', async () => {
    const path = join(dir, 'credentials.json');
    await writeFile(path, JSON.stringify(creds), { mode: 0o644 });
    await chmod(path, 0o644);
    const warnings: string[] = [];
    const store = new FileCredentialStore(path, { warn: (m) => warnings.push(m) });
    expect(await store.load()).toEqual(creds);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(warnings.join('')).toMatch(/permission/i);
  });

  it('上書き保存でき、一時ファイルを残さない', async () => {
    const path = join(dir, 'credentials.json');
    const store = new FileCredentialStore(path);
    await store.save(creds);
    await store.save({ ...creds, token: 'new-token-xyz' });
    expect((await store.load())?.token).toBe('new-token-xyz');
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(dir)).toEqual(['credentials.json']);
  });

  it('clear で削除する。無ければ false', async () => {
    const path = join(dir, 'credentials.json');
    const store = new FileCredentialStore(path);
    expect(await store.clear()).toBe(false);
    await store.save(creds);
    expect(await store.clear()).toBe(true);
    expect(await store.load()).toBeUndefined();
  });

  it('壊れたファイルはわかりやすいエラー', async () => {
    const path = join(dir, 'credentials.json');
    await mkdir(dir, { recursive: true });
    await writeFile(path, '{broken', { mode: 0o600 });
    await expect(new FileCredentialStore(path).load()).rejects.toThrow(/login/);
  });
});

describe('defaultCredentialsPath', () => {
  it('環境変数で変更できる', () => {
    expect(defaultCredentialsPath({ KINTAI_PLUS_CREDENTIALS_FILE: '/x/y.json' }, '/home/u')).toBe(
      '/x/y.json',
    );
  });

  it('XDG_CONFIG_HOME があればその下', () => {
    expect(defaultCredentialsPath({ XDG_CONFIG_HOME: '/cfg' }, '/home/u')).toBe(
      join('/cfg', 'kintai-plus-mcp', 'credentials.json'),
    );
  });

  it('既定は ~/.config/kintai-plus-mcp/credentials.json', () => {
    expect(defaultCredentialsPath({}, '/home/u')).toBe(
      join('/home/u', '.config', 'kintai-plus-mcp', 'credentials.json'),
    );
  });
});
