import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  diffDays,
  endOfDay,
  endOfMonth,
  formatCompactDate,
  formatIsoDateTime,
  formatSlashDate,
  formatSlashDateTime,
  formatStampQuery,
  isValidLocalDate,
  parseApiDate,
  parseApiDateTime,
  parseLocalDate,
  startOfDay,
  startOfMonth,
  todayInTokyo,
} from '../../src/time/datetime.ts';

// 2026-10-27 00:30 JST = 2026-10-26 15:30 UTC
const JUST_AFTER_MIDNIGHT_JST = new Date('2026-10-26T15:30:00Z');

describe('日本時間での日付', () => {
  it('UTC では前日でも日本時間の日付を返す', () => {
    expect(todayInTokyo(JUST_AFTER_MIDNIGHT_JST)).toBe('2026-10-27');
  });

  it('日の始まりと終わり（日本時間）', () => {
    expect(startOfDay('2026-10-27').toISOString()).toBe('2026-10-26T15:00:00.000Z');
    expect(endOfDay('2026-10-27').toISOString()).toBe('2026-10-27T14:59:59.000Z');
  });
});

describe('API への日時の形式', () => {
  it('打刻取得の期間: yyyymmddHHMMSS（日本時間）', () => {
    expect(formatStampQuery(JUST_AFTER_MIDNIGHT_JST)).toBe('20261027003000');
  });

  it('勤務実績の期間: yyyymmdd', () => {
    expect(formatCompactDate('2026-01-05')).toBe('20260105');
  });

  it('プロジェクト・工数: yyyy/mm/dd', () => {
    expect(formatSlashDate('2026-01-05')).toBe('2026/01/05');
  });

  it('打刻実行の stampedAt: YYYY/MM/DD HH:MM:SS（日本時間）', () => {
    expect(formatSlashDateTime(new Date('2026-01-05T00:04:09Z'))).toBe('2026/01/05 09:04:09');
  });

  it('ツールの返り値向け: ISO 8601（+09:00 付き）', () => {
    expect(formatIsoDateTime(new Date('2026-01-05T00:04:09.500Z'))).toBe(
      '2026-01-05T09:04:09+09:00',
    );
  });
});

describe('API からの日時の読み取り', () => {
  it('yyyy/mm/dd HH:MM:SS を日本時間として読む', () => {
    expect(parseApiDateTime('2026/10/27 09:00:00')?.toISOString()).toBe('2026-10-27T00:00:00.000Z');
  });

  it('タイムゾーン付きの ISO 形式も読む', () => {
    expect(parseApiDateTime('2026-10-27T09:00:00+09:00')?.toISOString()).toBe(
      '2026-10-27T00:00:00.000Z',
    );
  });

  it('null・空文字・不正な値は undefined', () => {
    expect(parseApiDateTime(null)).toBeUndefined();
    expect(parseApiDateTime('')).toBeUndefined();
    expect(parseApiDateTime('2026/13/40 25:00:00')).toBeUndefined();
  });

  it('日付は yyyy/mm/dd・yyyy-mm-dd・yyyymmdd を受け付ける', () => {
    expect(parseApiDate('2026/10/27')).toBe('2026-10-27');
    expect(parseApiDate('2026-10-27')).toBe('2026-10-27');
    expect(parseApiDate('20261027')).toBe('2026-10-27');
    expect(parseApiDate('2026/02/30')).toBeUndefined();
    expect(parseApiDate('2026/10-27')).toBeUndefined();
    expect(parseApiDate(null)).toBeUndefined();
  });
});

describe('暦日の計算', () => {
  it('isValidLocalDate / parseLocalDate', () => {
    expect(isValidLocalDate('2028-02-29')).toBe(true);
    expect(isValidLocalDate('2026-02-29')).toBe(false);
    expect(isValidLocalDate('2026-1-1')).toBe(false);
    expect(() => parseLocalDate('2026/01/01')).toThrow(/YYYY-MM-DD/);
    expect(parseLocalDate('2026-01-01')).toBe('2026-01-01');
  });

  it('addDays は月・年をまたぐ', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('diffDays は b - a の日数', () => {
    expect(diffDays('2026-10-01', '2026-10-31')).toBe(30);
    expect(diffDays('2026-10-31', '2026-10-01')).toBe(-30);
  });

  it('月初・月末・月の加算（末日は丸める）', () => {
    expect(startOfMonth('2026-10-27')).toBe('2026-10-01');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2026-10-15', -10)).toBe('2025-12-15');
  });
});
