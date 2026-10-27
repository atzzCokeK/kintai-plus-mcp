import { describe, expect, it } from 'vitest';
import type { WorkingRecord } from '../../src/api/working-records.ts';
import { assessOvertimeRisk, countWeekdays } from '../../src/domain/overtime-risk.ts';

const workday = (date: string, minutes: number): WorkingRecord => ({
  date,
  dayCategory: 'workday',
  actualWorkingMinutes: minutes,
});

describe('countWeekdays', () => {
  it('両端を含む平日（月〜金）の数', () => {
    expect(countWeekdays('2026-10-26', '2026-11-01')).toBe(5); // 月〜日
    expect(countWeekdays('2026-10-31', '2026-10-31')).toBe(0); // 土
    expect(countWeekdays('2026-11-02', '2026-11-01')).toBe(0);
  });
});

describe('assessOvertimeRisk', () => {
  it('ここまでのペースで月末の着地を予測する', () => {
    // 10/1〜10/16 の労働日 12 日で毎日 10 時間 → 時間外 2 時間 × 12 = 24 時間
    const records = Array.from({ length: 12 }, (_, i) =>
      workday(`2026-10-${String(i + 1).padStart(2, '0')}`, 600),
    );
    const r = assessOvertimeRisk({
      records,
      asOf: '2026-10-16',
      monthEnd: '2026-10-31',
      thresholdMinutes: 45 * 60,
    });
    // 残りの平日: 10/19〜10/30 の 10 日 → 24h + 2h × 10 = 44h
    expect(r).toMatchObject({
      overtimeSoFarMinutes: 1440,
      elapsedWorkDays: 12,
      remainingWorkDays: 10,
      projectedOvertimeMinutes: 2640,
      level: 'watch',
    });
  });

  it('既に超えていれば over、予測で超えるなら likely、余裕があれば ok', () => {
    const base = { asOf: '2026-10-16', monthEnd: '2026-10-31', thresholdMinutes: 45 * 60 };
    expect(
      assessOvertimeRisk({ ...base, records: [workday('2026-10-01', 480 + 46 * 60)] }).level,
    ).toBe('over');
    expect(
      assessOvertimeRisk({
        ...base,
        records: [workday('2026-10-01', 480 + 300), workday('2026-10-02', 480 + 300)],
      }).level,
    ).toBe('likely');
    expect(assessOvertimeRisk({ ...base, records: [workday('2026-10-01', 480)] }).level).toBe('ok');
  });

  it('月が終わっていれば予測 = 実績', () => {
    const r = assessOvertimeRisk({
      records: [workday('2026-09-01', 600)],
      asOf: '2026-09-30',
      monthEnd: '2026-09-30',
      thresholdMinutes: 45 * 60,
    });
    expect(r.remainingWorkDays).toBe(0);
    expect(r.projectedOvertimeMinutes).toBe(120);
  });

  it('まだ働いた日がなければ予測 0', () => {
    const r = assessOvertimeRisk({
      records: [],
      asOf: '2026-10-01',
      monthEnd: '2026-10-31',
      thresholdMinutes: 2700,
    });
    expect(r).toMatchObject({ projectedOvertimeMinutes: 0, level: 'ok' });
  });
});
