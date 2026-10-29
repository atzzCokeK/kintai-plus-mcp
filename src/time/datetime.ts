/**
 * 日時ユーティリティ。タイムゾーンは日本時間（Asia/Tokyo）固定。
 * 日本には夏時間がないので、UTC+9 の固定オフセットとして計算する。
 *
 * - 時刻（瞬間）は Date で扱う
 * - 暦日は `YYYY-MM-DD` の文字列（LocalDate）で扱う
 */

/** `YYYY-MM-DD` 形式の暦日（日本時間） */
export type LocalDate = string;

export const TIMEZONE = 'Asia/Tokyo';
export const JST_OFFSET = '+09:00';
const OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const API_DATE = /^(\d{4})([/-]?)(\d{2})\2(\d{2})$/;
const API_DATETIME = /^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
/** 仕様の `+09:00` のほか、実応答の `+9.00`（時が 1 桁、区切りが `.`）も受ける */
const OFFSET_SUFFIX = /([+-])(\d{1,2})[.:](\d{2})$/;

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function jstParts(date: Date): Parts {
  const d = new Date(date.getTime() + OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function ymd(year: number, month: number, day: number): LocalDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function splitLocalDate(date: LocalDate): [number, number, number] {
  const m = LOCAL_DATE.exec(date);
  if (!m) throw new RangeError(`Invalid date: ${date} (expected YYYY-MM-DD)`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** JST の暦日・時刻から Date を作る */
function fromJst(p: Parts): Date {
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - OFFSET_MS);
}

// ---- 暦日 ----

export function isValidLocalDate(value: string): boolean {
  const m = LOCAL_DATE.exec(value);
  return m !== null && isValidYmd(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** ユーザー入力の日付を検証する。不正なら RangeError。 */
export function parseLocalDate(value: string): LocalDate {
  if (!isValidLocalDate(value)) {
    throw new RangeError(`Invalid date: ${value} (expected YYYY-MM-DD)`);
  }
  return value;
}

export function todayInTokyo(now: Date = new Date()): LocalDate {
  const p = jstParts(now);
  return ymd(p.year, p.month, p.day);
}

export function toLocalDate(date: Date): LocalDate {
  return todayInTokyo(date);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = splitLocalDate(date);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** b - a の日数 */
export function diffDays(a: LocalDate, b: LocalDate): number {
  const [ay, am, ad] = splitLocalDate(a);
  const [by, bm, bd] = splitLocalDate(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

export function startOfMonth(date: LocalDate): LocalDate {
  const [y, m] = splitLocalDate(date);
  return ymd(y, m, 1);
}

export function endOfMonth(date: LocalDate): LocalDate {
  const [y, m] = splitLocalDate(date);
  return ymd(y, m, daysInMonth(y, m));
}

/** 月を加算する。加算先にその日がなければ月末に丸める（1/31 + 1 ヶ月 = 2/28）。 */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const [y, m, d] = splitLocalDate(date);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return ymd(year, month, Math.min(d, daysInMonth(year, month)));
}

/** その日の 00:00:00（日本時間） */
export function startOfDay(date: LocalDate): Date {
  const [year, month, day] = splitLocalDate(date);
  return fromJst({ year, month, day, hour: 0, minute: 0, second: 0 });
}

/** その日の 23:59:59（日本時間）。API の期間指定は秒単位で両端を含むため。 */
export function endOfDay(date: LocalDate): Date {
  const [year, month, day] = splitLocalDate(date);
  return fromJst({ year, month, day, hour: 23, minute: 59, second: 59 });
}

// ---- API へ渡す形式 ----

/** 打刻取得の期間: yyyymmddHHMMSS */
export function formatStampQuery(date: Date): string {
  const p = jstParts(date);
  return `${pad(p.year, 4)}${pad(p.month)}${pad(p.day)}${pad(p.hour)}${pad(p.minute)}${pad(p.second)}`;
}

/** 勤務実績の期間: yyyymmdd */
export function formatCompactDate(date: LocalDate): string {
  return parseLocalDate(date).replaceAll('-', '');
}

/** プロジェクト・工数: yyyy/mm/dd */
export function formatSlashDate(date: LocalDate): string {
  return parseLocalDate(date).replaceAll('-', '/');
}

/** 打刻実行の stampedAt: YYYY/MM/DD HH:MM:SS */
export function formatSlashDateTime(date: Date): string {
  const p = jstParts(date);
  return `${pad(p.year, 4)}/${pad(p.month)}/${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** ツールの返り値向け: 2026-01-05T09:04:09+09:00 */
export function formatIsoDateTime(date: Date): string {
  const p = jstParts(date);
  return `${ymd(p.year, p.month, p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${JST_OFFSET}`;
}

// ---- API から受け取る形式 ----

/** `+9.00` や `+09:00` を `+09:00` に揃える。タイムゾーンが無ければそのまま返す。 */
function normalizeOffset(text: string): string {
  return text.replace(OFFSET_SUFFIX, (_, sign: string, hour: string, minute: string) => {
    return `${sign}${hour.padStart(2, '0')}:${minute}`;
  });
}

/** yyyy/mm/dd HH:MM:SS（日本時間）やタイムゾーン付き ISO 8601 を読む。読めなければ undefined。 */
export function parseApiDateTime(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const text = normalizeOffset(value.trim());
  if (ISO_WITH_ZONE.test(text)) {
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const offset = /([+-]\d{2}:\d{2})$/.exec(text);
  const wall = offset ? text.slice(0, offset.index).trim() : text;
  const m = API_DATETIME.exec(wall);
  if (!m) return undefined;
  const p: Parts = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6] ?? 0),
  };
  if (!isValidYmd(p.year, p.month, p.day) || p.hour > 23 || p.minute > 59 || p.second > 59) {
    return undefined;
  }
  if (!offset) return fromJst(p);
  const sign = offset[1]?.startsWith('-') ? -1 : 1;
  const hours = Number(offset[1]?.slice(1, 3));
  const minutes = Number(offset[1]?.slice(4, 6));
  const offsetMs = sign * (hours * 60 + minutes) * 60_000;
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - offsetMs);
}

/** yyyy/mm/dd・yyyy-mm-dd・yyyymmdd を LocalDate にする。読めなければ undefined。 */
export function parseApiDate(value: string | null | undefined): LocalDate | undefined {
  if (!value) return undefined;
  const m = API_DATE.exec(value.trim());
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[3]), Number(m[4])];
  return isValidYmd(y, mo, d) ? ymd(y, mo, d) : undefined;
}
