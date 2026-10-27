import { describe, expect, it } from 'vitest';
import {
  chunk,
  LimitExceededError,
  paginate,
  splitByDays,
  splitByMonths,
} from '../../src/api/paging.ts';

describe('splitByDays（勤務実績は 31 日まで）', () => {
  it('期間内ならそのまま 1 つ', () => {
    expect(splitByDays('2026-10-01', '2026-10-31', 31)).toEqual([
      { from: '2026-10-01', to: '2026-10-31' },
    ]);
  });

  it('31 日ごとに分割する（両端を含む）', () => {
    expect(splitByDays('2026-01-01', '2026-03-15', 31)).toEqual([
      { from: '2026-01-01', to: '2026-01-31' },
      { from: '2026-02-01', to: '2026-03-03' },
      { from: '2026-03-04', to: '2026-03-15' },
    ]);
  });

  it('1 日だけの期間', () => {
    expect(splitByDays('2026-10-27', '2026-10-27', 31)).toEqual([
      { from: '2026-10-27', to: '2026-10-27' },
    ]);
  });

  it('開始が終了より後ならエラー', () => {
    expect(() => splitByDays('2026-10-02', '2026-10-01', 31)).toThrow(RangeError);
  });

  it('分割数が上限を超えたら LimitExceededError', () => {
    expect(() => splitByDays('2020-01-01', '2026-01-01', 31, { maxChunks: 13 })).toThrow(
      LimitExceededError,
    );
  });
});

describe('splitByMonths（打刻は 6 ヶ月まで）', () => {
  it('6 ヶ月ごとに分割する', () => {
    expect(splitByMonths('2026-01-01', '2026-12-31', 6)).toEqual([
      { from: '2026-01-01', to: '2026-06-30' },
      { from: '2026-07-01', to: '2026-12-31' },
    ]);
  });

  it('月末起点でも各区間は 6 ヶ月を超えない', () => {
    const ranges = splitByMonths('2026-08-31', '2027-12-31', 6);
    expect(ranges[0]).toEqual({ from: '2026-08-31', to: '2027-02-27' });
    expect(ranges.at(-1)?.to).toBe('2027-12-31');
  });
});

describe('chunk（複数従業員の打刻は 50 人まで）', () => {
  it('配列を指定の大きさに分ける', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 50)).toEqual([]);
  });
});

describe('paginate（従業員一覧は 20 人/ページ、page は 0 始まり）', () => {
  const people = Array.from({ length: 45 }, (_, i) => i + 1);
  const fetchPage = (pages: number[]) => async (page: number) => {
    pages.push(page);
    return { items: people.slice(page * 20, page * 20 + 20), totalCount: people.length };
  };

  it('TotalCount に達するまでページを送る', async () => {
    const pages: number[] = [];
    const result = await paginate(fetchPage(pages), { pageSize: 20 });
    expect(result.items).toEqual(people);
    expect(result.totalCount).toBe(45);
    expect(result.truncated).toBe(false);
    expect(pages).toEqual([0, 1, 2]);
  });

  it('上限件数で打ち切り、truncated を立てる', async () => {
    const pages: number[] = [];
    const result = await paginate(fetchPage(pages), { pageSize: 20, maxItems: 30 });
    expect(result.items).toEqual(people.slice(0, 30));
    expect(result.truncated).toBe(true);
    expect(pages).toEqual([0, 1]);
  });

  it('TotalCount がなくても、件数がページサイズ未満になったら止める', async () => {
    const pages: number[] = [];
    const result = await paginate(
      async (page) => {
        pages.push(page);
        return { items: people.slice(page * 20, page * 20 + 20) };
      },
      { pageSize: 20 },
    );
    expect(result.items).toHaveLength(45);
    expect(result.totalCount).toBeUndefined();
    expect(pages).toEqual([0, 1, 2]);
  });

  it('空ページで止まる（無限ループ防止）', async () => {
    const result = await paginate(async () => ({ items: [], totalCount: 100 }), { pageSize: 20 });
    expect(result.items).toEqual([]);
  });

  it('最大ページ数を超えたら止めて truncated を立てる', async () => {
    const pages: number[] = [];
    const result = await paginate(
      async (page) => {
        pages.push(page);
        return { items: Array(20).fill(page) };
      },
      { pageSize: 20, maxPages: 3 },
    );
    expect(pages).toEqual([0, 1, 2]);
    expect(result.truncated).toBe(true);
  });

  it('開始ページを指定できる（1 始まりの API 向け）', async () => {
    const pages: number[] = [];
    await paginate(
      async (page) => {
        pages.push(page);
        return { items: page === 1 ? [1] : [] };
      },
      { pageSize: 50, firstPage: 1 },
    );
    expect(pages).toEqual([1]);
  });
});
