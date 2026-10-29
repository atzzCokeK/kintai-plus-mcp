import * as z from 'zod/v4';
import type { DateRange } from '../api/paging.ts';
import { diffDays, isValidLocalDate, type LocalDate, todayInTokyo } from '../time/datetime.ts';
import { ToolInputError } from './result.ts';

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .describe('Date in YYYY-MM-DD (Japan time)');

/** 月。01–12 以外（2026-13 など）は拒否する */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM (month 01-12)');

export function assertMonth(month: string): void {
  if (!monthSchema.safeParse(month).success) {
    throw new ToolInputError(`Invalid month: ${month} (use YYYY-MM, month 01-12)`);
  }
}

export interface RangeInput {
  from?: string | undefined;
  to?: string | undefined;
}

export interface RangeDefaults {
  /** from を省略したときの値（既定: 今日） */
  from?: LocalDate;
  /** to を省略したときの値（既定: from と同じ日） */
  to?: (from: LocalDate) => LocalDate;
  /** 期間の最大日数（両端を含む） */
  maxDays: number;
}

/** ツール入力の期間を検証して DateRange にする */
export function resolveRange(input: RangeInput, now: Date, defaults: RangeDefaults): DateRange {
  const from = input.from ?? defaults.from ?? todayInTokyo(now);
  const to = input.to ?? defaults.to?.(from) ?? from;
  for (const [name, value] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (!isValidLocalDate(value))
      throw new ToolInputError(`Invalid ${name} date: ${value} (use YYYY-MM-DD)`);
  }
  const days = diffDays(from, to) + 1;
  if (days < 1) throw new ToolInputError(`from (${from}) must be on or before to (${to})`);
  if (days > defaults.maxDays) {
    throw new ToolInputError(
      `The period is ${days} days; the maximum is ${defaults.maxDays} days. Use a shorter period.`,
    );
  }
  return { from, to };
}

/** 分を「H:MM」にする（AI が時間として読み違えないように併記する） */
export function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}
