import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type ConfirmLevel, isConfirmLevel } from './confirm.ts';
import { defaultCredentialsPath } from './credentials/file-store.ts';

type Env = Record<string, string | undefined>;

/** 認証情報と同じディレクトリの settings.json。トークンは入れない。 */
export function settingsPath(env: Env = process.env): string {
  return join(dirname(defaultCredentialsPath(env)), 'settings.json');
}

/**
 * 保存済みの確認レベル。ファイルが無いときは undefined。
 * 壊れているときは warn して undefined（起動は止めない）。中身はログに出さない。
 */
export async function loadSavedConfirm(
  path: string,
  warn: (message: string) => void,
): Promise<ConfirmLevel | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    warn('Could not read settings.json. Using the default confirmation level.');
    return undefined;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    warn('settings.json is not valid JSON. Using the default confirmation level.');
    return undefined;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    warn('settings.json is invalid. Using the default confirmation level.');
    return undefined;
  }
  const confirm = (data as { confirm?: unknown }).confirm;
  if (confirm === undefined) return undefined;
  if (!isConfirmLevel(confirm)) {
    warn('settings.json has an invalid confirm value. Using the default confirmation level.');
    return undefined;
  }
  return confirm;
}

export async function saveSettings(path: string, confirm: ConfirmLevel): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ confirm })}\n`, { mode: 0o600 });
}
