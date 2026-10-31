import { API_HOSTS, type ApiHost } from '../api/endpoint.ts';
import type { ArrowChoice } from './arrow-select.ts';

/** 矢印選択で最初に光っている接続先。非対話で空のときもこれ。 */
export const DEFAULT_API_HOST: ApiHost = 'atnd.ak4.jp';

const HOST_HINTS: Record<ApiHost, string> = {
  'atnd.ak4.jp': 'https://atnd.ak4.jp/ でログインしている',
  'atnd-awj.ak4.jp': 'https://atnd-awj.ak4.jp/ でログインしている',
};

export const HOST_SELECT_MESSAGE = [
  '接続先（ログイン後のブラウザの URL のドメイン）',
  '↑/↓ で移動、Enter で決定',
].join('\n');

export function hostSelectChoices(): readonly ArrowChoice<ApiHost>[] {
  return API_HOSTS.map((host) => ({
    value: host,
    label: host,
    hint: host === DEFAULT_API_HOST ? `${HOST_HINTS[host]}（既定）` : HOST_HINTS[host],
  }));
}
