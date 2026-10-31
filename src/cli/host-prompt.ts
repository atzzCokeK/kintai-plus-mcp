import { API_HOSTS, type ApiHost, parseApiHost } from '../api/endpoint.ts';

/** 番号を空 Enter したとき、および非対話で空のときの接続先。 */
export const DEFAULT_API_HOST: ApiHost = 'atnd.ak4.jp';

const HOST_HINTS: Record<ApiHost, string> = {
  'atnd.ak4.jp': 'https://atnd.ak4.jp/ でログインしている',
  'atnd-awj.ak4.jp': 'https://atnd-awj.ak4.jp/ でログインしている',
};

/** 対話端末に出す接続先の番号一覧。末尾は改行しない（入力と同じ行に続ける）。 */
export function formatInteractiveHostPrompt(): string {
  const width = Math.max(...API_HOSTS.map((host) => host.length));
  const lines = ['接続先（ログイン後のブラウザの URL のドメイン）:'];
  for (const [i, host] of API_HOSTS.entries()) {
    const suffix = host === DEFAULT_API_HOST ? '（既定）' : '';
    lines.push(`  ${i + 1}) ${host.padEnd(width)}  ${HOST_HINTS[host]}${suffix}`);
  }
  const defaultNumber = API_HOSTS.indexOf(DEFAULT_API_HOST) + 1;
  lines.push(`番号 [${defaultNumber}]: `);
  return lines.join('\n');
}

/**
 * 番号（空は既定）、または既知のホスト名やログイン URL を接続先にする。
 * 未知のホスト用の自由入力は受け付けない。
 */
export function parseHostSelection(input: string): ApiHost | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return DEFAULT_API_HOST;
  if (/^[1-9]\d*$/.test(trimmed)) return API_HOSTS[Number(trimmed) - 1];
  return parseApiHost(trimmed);
}

export function interactiveHostError(): string {
  const choices = API_HOSTS.map((host, i) => `${i + 1}: ${host}`).join('、');
  return `接続先は番号で選んでください（${choices}）。\n`;
}
