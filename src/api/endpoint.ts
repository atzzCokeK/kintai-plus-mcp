/** クラウド勤怠Plus の接続先。ログイン後の URL のドメインに合わせる。 */
export const API_HOSTS = ['atnd.ak4.jp', 'atnd-awj.ak4.jp'] as const;
export type ApiHost = (typeof API_HOSTS)[number];

export interface Connection {
  host: ApiHost;
  /** ログイン企業 ID */
  companyId: string;
}

/** パス中で企業 ID に置き換わる要素 */
export const COMPANY_ID = '{companyId}';

export type PathSegment = string | number;
export type QueryValue = string | number | boolean | readonly (string | number)[] | undefined;
export type Query = Record<string, QueryValue>;

const BASE_PATH = '/api/cooperation';
const COMPANY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isApiHost(value: string): value is ApiHost {
  return (API_HOSTS as readonly string[]).includes(value);
}

/** 入力された文字列（URL でもよい）から接続先を取り出す。対象外なら undefined。 */
export function parseApiHost(input: string): ApiHost | undefined {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === '') return undefined;
  let hostname: string;
  try {
    hostname = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return undefined;
  }
  return isApiHost(hostname) ? hostname : undefined;
}

export function isValidCompanyId(value: string): boolean {
  return COMPANY_ID_PATTERN.test(value);
}

export function buildApiUrl(
  conn: Connection,
  segments: readonly PathSegment[],
  query?: Query,
): URL {
  if (!isApiHost(conn.host)) {
    throw new Error(`Unsupported host: ${String(conn.host)}`);
  }
  if (!isValidCompanyId(conn.companyId)) {
    throw new Error('Invalid company ID (ログイン企業ID)');
  }
  const parts = segments.map((segment) => {
    if (segment === COMPANY_ID) return conn.companyId;
    const text = String(segment);
    if (text === '' || text === '.' || text === '..') {
      throw new Error(`Invalid path segment: ${JSON.stringify(text)}`);
    }
    return encodeURIComponent(text);
  });
  const url = new URL(`https://${conn.host}${BASE_PATH}/${parts.join('/')}`);
  if (query) appendQuery(url, query);
  return url;
}

export function appendQuery(url: URL, query: Query): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    url.searchParams.append(key, Array.isArray(value) ? value.join(',') : String(value));
  }
}
