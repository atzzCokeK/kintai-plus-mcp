import { addDays, addMonths, diffDays, type LocalDate } from '../time/datetime.ts';
import { API_CODE, hasErrorCode } from './errors.ts';

/**
 * API の制約（期間・件数・ページ）に合わせて呼び出しを分けるためのヘルパー。
 * 際限なく呼ばないように、どれも上限を持つ。
 */

export interface DateRange {
  from: LocalDate;
  to: LocalDate;
}

/** 上限を超える要求を表す。AI が期間や対象を絞って再実行できるよう、メッセージで伝える。 */
export class LimitExceededError extends Error {
  override readonly name = 'LimitExceededError';
}

export interface SplitOptions {
  /** 分割後の区間数の上限（既定 24） */
  maxChunks?: number;
}

const DEFAULT_MAX_CHUNKS = 24;

/** 両端を含む期間を、各区間が maxDays 日以内になるように分ける。 */
export function splitByDays(
  from: LocalDate,
  to: LocalDate,
  maxDays: number,
  options: SplitOptions = {},
): DateRange[] {
  return split(from, to, (start) => addDays(start, maxDays - 1), options);
}

/** 両端を含む期間を、各区間が months ヶ月以内になるように分ける。 */
export function splitByMonths(
  from: LocalDate,
  to: LocalDate,
  months: number,
  options: SplitOptions = {},
): DateRange[] {
  return split(from, to, (start) => addDays(addMonths(start, months), -1), options);
}

function split(
  from: LocalDate,
  to: LocalDate,
  lastDayOf: (start: LocalDate) => LocalDate,
  options: SplitOptions,
): DateRange[] {
  if (diffDays(from, to) < 0) {
    throw new RangeError(`Start date ${from} is after end date ${to}`);
  }
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const ranges: DateRange[] = [];
  let start = from;
  while (diffDays(start, to) >= 0) {
    if (ranges.length >= maxChunks) {
      throw new LimitExceededError(
        `The period ${from}..${to} is too long (more than ${maxChunks} requests). Please use a shorter period.`,
      );
    }
    const last = lastDayOf(start);
    const end = diffDays(last, to) < 0 ? to : last;
    ranges.push({ from: start, to: end });
    start = addDays(end, 1);
  }
  return ranges;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new RangeError('size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface Page<T> {
  items: T[];
  totalCount?: number | undefined;
}

export interface PaginateOptions {
  pageSize: number;
  /** 最初のページ番号（既定 0） */
  firstPage?: number;
  /** 取得する件数の上限 */
  maxItems?: number;
  /** 取得するページ数の上限（既定 50） */
  maxPages?: number;
}

export interface Paginated<T> {
  items: T[];
  totalCount: number | undefined;
  /** 上限で打ち切ったら true */
  truncated: boolean;
}

const DEFAULT_MAX_PAGES = 50;

export async function paginate<T>(
  fetchPage: (page: number) => Promise<Page<T>>,
  options: PaginateOptions,
): Promise<Paginated<T>> {
  const firstPage = options.firstPage ?? 0;
  const maxItems = options.maxItems ?? Number.POSITIVE_INFINITY;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const items: T[] = [];
  let totalCount: number | undefined;

  for (let i = 0; i < maxPages; i++) {
    let page: Page<T>;
    try {
      page = await fetchPage(firstPage + i);
    } catch (error) {
      // 範囲外の page は空配列ではなく 404 ERR300602。ページサイズで割り切れると次のページがこれになる。
      if (hasErrorCode(error, API_CODE.pageOutOfRange)) {
        return { items, totalCount, truncated: false };
      }
      throw error;
    }
    totalCount = page.totalCount ?? totalCount;
    items.push(...page.items);

    if (items.length > maxItems) {
      return { items: items.slice(0, maxItems), totalCount, truncated: true };
    }
    const done =
      page.items.length === 0 ||
      page.items.length < options.pageSize ||
      (totalCount !== undefined && items.length >= totalCount);
    if (done) return { items, totalCount, truncated: false };
    if (items.length === maxItems) {
      return { items, totalCount, truncated: true };
    }
  }
  return { items, totalCount, truncated: true };
}
