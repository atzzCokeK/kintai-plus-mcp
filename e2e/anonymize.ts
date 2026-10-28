/**
 * 実環境のレスポンスをフィクスチャにする前の匿名化（CLAUDE.md「守ること」）。
 * 氏名・カナ・社員番号・メール・部署名・プロジェクト名などの名称・コメント・位置情報・IP・トークン・企業 ID を
 * 架空の値に置き換える。ID・日時・コード値・構造は保つ。同じ値は同じ架空の値になる。
 *
 * 使い方: node e2e/anonymize.ts <入力.json> [出力.json]
 */
type Category =
  | 'last'
  | 'first'
  | 'lastKana'
  | 'firstKana'
  | 'name'
  | 'email'
  | 'staffNum'
  | 'code'
  | 'comment'
  | 'ip'
  | 'company';

const KEY_CATEGORY: Record<string, Category> = {
  lastName: 'last',
  last_name: 'last',
  familyName: 'last',
  family_name: 'last',
  firstName: 'first',
  first_name: 'first',
  givenName: 'first',
  given_name: 'first',
  lastNameKana: 'lastKana',
  last_name_kana: 'lastKana',
  firstNameKana: 'firstKana',
  first_name_kana: 'firstKana',
  name: 'name',
  staffName: 'name',
  staff_name: 'name',
  short_name: 'name',
  shortName: 'name',
  organizationName: 'name',
  organization_name: 'name',
  title: 'name',
  email: 'email',
  mail: 'email',
  staffNum: 'staffNum',
  staff_num: 'staffNum',
  staffNumber: 'staffNum',
  staff_number: 'staffNum',
  project_code: 'code',
  projectCode: 'code',
  code: 'code',
  comment: 'comment',
  ip: 'ip',
  ip_address: 'ip',
  ipAddress: 'ip',
  login_company_code: 'company',
  companyId: 'company',
  company_id: 'company',
};

const LOCATION_KEYS = new Set(['latitude', 'longitude', 'lat', 'lng', 'lon']);
const TOKEN_KEYS = new Set(['token', 'access_token', 'accessToken']);

export function anonymize(value: unknown): unknown {
  const maps = new Map<Category, Map<string, string>>();
  const fake = (category: Category, original: string): string => {
    let map = maps.get(category);
    if (!map) {
      map = new Map();
      maps.set(category, map);
    }
    let replacement = map.get(original);
    if (replacement === undefined) {
      replacement = make(category, map.size + 1);
      map.set(original, replacement);
    }
    return replacement;
  };

  const walk = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return v.map((item) => walk(item, key));
    if (typeof v === 'object' && v !== null) {
      return Object.fromEntries(Object.entries(v).map(([k, child]) => [k, walk(child, k)]));
    }
    if (key === undefined || v === null || v === undefined) return v;
    if (TOKEN_KEYS.has(key) && typeof v === 'string') return 'REDACTED-TOKEN';
    if (LOCATION_KEYS.has(key) && typeof v === 'number')
      return key.startsWith('lo') || key === 'lng' ? 139.0 : 35.0;
    if (LOCATION_KEYS.has(key) && typeof v === 'string')
      return key.startsWith('lo') || key === 'lng' ? '139.0' : '35.0';
    const category = KEY_CATEGORY[key];
    if (category && typeof v === 'string' && v !== '') return fake(category, v);
    return v;
  };
  return walk(value);
}

function make(category: Category, n: number): string {
  switch (category) {
    case 'last':
      return `架空${n}`;
    case 'first':
      return `太郎${n}`;
    case 'lastKana':
      return `カクウ${n}`;
    case 'firstKana':
      return `タロウ${n}`;
    case 'name':
      return `名称${n}`;
    case 'email':
      return `user${n}@example.com`;
    case 'staffNum':
      return `E${String(n).padStart(4, '0')}`;
    case 'code':
      return `CODE${n}`;
    case 'comment':
      return `コメント${n}`;
    case 'ip':
      return `192.0.2.${n % 255}`;
    case 'company':
      return n === 1 ? 'example-co' : `example-co-${n}`;
  }
}

// コマンドとして実行されたとき
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const [input, output] = process.argv.slice(2);
  if (!input) {
    process.stderr.write('usage: node e2e/anonymize.ts <input.json> [output.json]\n');
    process.exit(2);
  }
  const text = `${JSON.stringify(anonymize(JSON.parse(await readFile(input, 'utf8'))), null, 2)}\n`;
  if (output) await writeFile(output, text);
  else process.stdout.write(text);
}
