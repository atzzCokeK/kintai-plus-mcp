import { describe, expect, it } from 'vitest';
import { parseWorkingRecords } from '../../src/api/working-records.ts';

describe('parseWorkingRecords', () => {
  const record = {
    date: '2026/10/27',
    working_day_category: 0,
    start_time: '2026/10/27 09:00:00',
    end_time: '2026/10/27 18:30:00',
    rounded_start_time: '2026/10/27 09:00:00',
    rounded_end_time: '2026/10/27 18:30:00',
    attendance_punch_time: '2026/10/27 08:55:00',
    leaving_punch_time: '2026/10/27 18:31:00',
    actual_working_hours_no_rounding: 510,
    break_time_results: [{ start_time: '2026/10/27 12:00:00', end_time: '2026/10/27 13:00:00' }],
  };

  it('1 日分の項目を読む', () => {
    const [r] = parseWorkingRecords({ working_records: [record] });
    expect(r).toEqual({
      date: '2026-10-27',
      dayCategory: 'workday',
      startTime: new Date('2026-10-27T00:00:00Z'),
      endTime: new Date('2026-10-27T09:30:00Z'),
      clockInAt: new Date('2026-10-26T23:55:00Z'),
      clockOutAt: new Date('2026-10-27T09:31:00Z'),
      actualWorkingMinutes: 510,
      breakMinutes: 60,
    });
  });

  it('労働区分: 0 労働日 / 1 所定休日 / 2 法定休日', () => {
    const cats = [0, 1, 2, 9].map(
      (c) => parseWorkingRecords([{ ...record, working_day_category: c }])[0]?.dayCategory,
    );
    expect(cats).toEqual(['workday', 'scheduled_holiday', 'legal_holiday', 'unknown']);
  });

  it('時刻だけの値（HH:MM、24 時以降を含む）も、その日の時刻として読む', () => {
    const [r] = parseWorkingRecords([{ ...record, start_time: '22:00', end_time: '26:30' }]);
    expect(r?.startTime?.toISOString()).toBe('2026-10-27T13:00:00.000Z');
    expect(r?.endTime?.toISOString()).toBe('2026-10-27T17:30:00.000Z');
  });

  it('値なし（null）は省く。実働が "H:MM" 文字列でも読む', () => {
    const [r] = parseWorkingRecords([
      {
        date: '2026/10/26',
        working_day_category: 1,
        start_time: null,
        end_time: null,
        actual_working_hours_no_rounding: '7:45',
        break_time_results: [],
      },
    ]);
    expect(r).toEqual({
      date: '2026-10-26',
      dayCategory: 'scheduled_holiday',
      actualWorkingMinutes: 465,
      breakMinutes: 0,
    });
  });

  it('従業員ごとに包まれた形を読み、staffId を付ける', () => {
    const rs = parseWorkingRecords([
      { staff_id: 5, working_records: [record] },
      { staff_id: 6, working_records: [{ ...record, date: '2026/10/26' }] },
    ]);
    expect(rs.map((r) => [r.staffId, r.date])).toEqual([
      [6, '2026-10-26'],
      [5, '2026-10-27'],
    ]);
  });

  it('実働と休憩が無いときは開始〜終了の経過を見積もり、休憩は不明（日をまたいでも）', () => {
    const [overnight] = parseWorkingRecords([
      {
        date: '2026/10/20',
        working_day_category: 0,
        start_time: '2026/10/20 22:00:00',
        end_time: '2026/10/22 20:03:00',
        rounded_start_time: '2026/10/20 22:00:00',
        rounded_end_time: '2026/10/22 20:00:00',
        attendance_punch_time: '2026/10/20 21:58:00',
        leaving_punch_time: '2026/10/22 20:03:00',
      },
    ]);
    expect(overnight).toMatchObject({
      date: '2026-10-20',
      actualWorkingMinutes: 2763,
      workingMinutesAreGross: true,
    });
    expect(overnight?.breakMinutes).toBeUndefined();
    expect(overnight?.endTime?.toISOString()).toBe('2026-10-22T11:03:00.000Z');
  });

  it('開始終了が無く rounded_* だけならそちらで見積もる', () => {
    const [r] = parseWorkingRecords([
      {
        date: '2026/10/21',
        working_day_category: 0,
        rounded_start_time: '2026/10/21 09:00:00',
        rounded_end_time: '2026/10/21 18:00:00',
      },
    ]);
    expect(r?.actualWorkingMinutes).toBe(540);
    expect(r?.workingMinutesAreGross).toBe(true);
    expect(r?.startTime).toBeUndefined();
    expect(r?.breakMinutes).toBeUndefined();
  });

  it('response が従業員ごとの配列でも読む', () => {
    const rs = parseWorkingRecords([{ staff_id: '1001', working_records: [record] }]);
    expect(rs[0]).toMatchObject({ staffId: 1001, actualWorkingMinutes: 510, breakMinutes: 60 });
    expect(rs[0]?.workingMinutesAreGross).toBeUndefined();
  });

  it('休憩が分数で来ても合計する', () => {
    const [r] = parseWorkingRecords([
      { ...record, break_time_results: [{ break_time: 45 }, { minutes: 15 }] },
    ]);
    expect(r?.breakMinutes).toBe(60);
  });
});
