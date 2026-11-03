import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { needsConfirm } from '../src/confirm.ts';
import { createRuntime } from '../src/runtime.ts';
import { loadSavedConfirm, saveSettings, settingsPath } from '../src/settings.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kintai-plus-mcp-settings-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('needsConfirm', () => {
  const write = { kind: 'write' as const, destructive: false };
  const remove = { kind: 'write' as const, destructive: true };
  const read = { kind: 'read' as const };

  it('always は書き込み全部、destructive は削除だけ、never はどれも確認しない', () => {
    expect(needsConfirm(write, 'always')).toBe(true);
    expect(needsConfirm(remove, 'always')).toBe(true);
    expect(needsConfirm(read, 'always')).toBe(false);
    expect(needsConfirm(write, 'destructive')).toBe(false);
    expect(needsConfirm(remove, 'destructive')).toBe(true);
    expect(needsConfirm(remove, 'never')).toBe(false);
    expect(needsConfirm(write, 'never')).toBe(false);
  });
});

describe('settings.json', () => {
  it('確認レベルを保存して読める。ファイルが無ければ undefined', async () => {
    const path = join(dir, 'settings.json');
    const warnings: string[] = [];
    expect(await loadSavedConfirm(path, (message) => warnings.push(message))).toBeUndefined();
    expect(warnings).toEqual([]);
    await saveSettings(path, 'always');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ confirm: 'always' });
    expect(await loadSavedConfirm(path, (message) => warnings.push(message))).toBe('always');
    expect(warnings).toEqual([]);
  });

  it('壊れたファイルは警告して無視する。中身はログに出さない', async () => {
    const path = join(dir, 'settings.json');
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    await writeFile(path, '{not json token=secret-value', { mode: 0o600 });
    expect(await loadSavedConfirm(path, warn)).toBeUndefined();
    await writeFile(path, '[]', { mode: 0o600 });
    expect(await loadSavedConfirm(path, warn)).toBeUndefined();
    await writeFile(path, '{"confirm":"sometimes"}', { mode: 0o600 });
    expect(await loadSavedConfirm(path, warn)).toBeUndefined();
    await writeFile(path, '{}', { mode: 0o600 });
    expect(await loadSavedConfirm(path, warn)).toBeUndefined();
    expect(warnings.join('\n')).toMatch(/invalid|JSON/);
    expect(warnings.join('\n')).not.toContain('secret-value');
    await mkdir(join(dir, 'not-a-file'));
    expect(await loadSavedConfirm(join(dir, 'not-a-file'), warn)).toBeUndefined();
    expect(warnings.at(-1)).toMatch(/Could not read/);
  });

  it('起動時は保存した値を使い、環境変数があればそちらが勝つ', async () => {
    const credentialsFile = join(dir, 'credentials.json');
    const env = { KINTAI_PLUS_CREDENTIALS_FILE: credentialsFile, KINTAI_PLUS_LOG_LEVEL: 'warn' };
    await saveSettings(settingsPath(env), 'always');
    const fromFile = await createRuntime({ env, fetch: async () => new Response('{}') });
    expect(fromFile.config).toMatchObject({ confirm: 'always', confirmSource: 'settings' });

    const warnings: string[] = [];
    const overridden = await createRuntime({
      env: { ...env, KINTAI_PLUS_CONFIRM: 'never' },
      fetch: async () => new Response('{}'),
      writeLog: (line) => warnings.push(line),
    });
    expect(overridden.config).toMatchObject({ confirm: 'never', confirmSource: 'env' });
    expect(warnings.join('')).not.toContain('always');
  });

  it('壊れた設定でも起動し、中身をログに出さずに既定へ戻す', async () => {
    const credentialsFile = join(dir, 'credentials.json');
    const env = { KINTAI_PLUS_CREDENTIALS_FILE: credentialsFile };
    await writeFile(settingsPath(env), '{confirm:"always"', 'utf8');
    const logs: string[] = [];
    const runtime = await createRuntime({
      env,
      fetch: async () => new Response('{}'),
      writeLog: (line) => logs.push(line),
    });
    expect(runtime.config).toMatchObject({ confirm: 'destructive', confirmSource: 'default' });
    expect(logs.join('')).toMatch(/settings.json/);
    expect(logs.join('')).not.toContain('always');
  });
});
