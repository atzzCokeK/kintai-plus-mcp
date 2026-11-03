import { describe, expect, it } from 'vitest';
import type { Alert } from '../../src/api/alerts.ts';
import type { ManhourDay } from '../../src/api/manhours.ts';
import { STAMP_TYPE_CODES, type Stamp, type StampType } from '../../src/api/stamps.ts';
import type { DayCategory, WorkingRecord } from '../../src/api/working-records.ts';
import {
  buildCloseout,
  type CloseoutInput,
  type CloseoutItem,
  type CloseoutReport,
  requiredBreakMinutes,
} from '../../src/domain/close-out.ts';

const s = (type: StampType, iso: string): Stamp => ({
  type,
  typeCode: STAMP_TYPE_CODES[type],
  stampedAt: new Date(iso),
  attributes: {},
});

const rec = (
  date: string,
  dayCategory: DayCategory,
  minutes?: number,
  extra: Partial<WorkingRecord> = {},
): WorkingRecord => ({
  date,
  dayCategory,
  ...(minutes === undefined ? {} : { actualWorkingMinutes: minutes }),
  ...extra,
});

const mh = (date: string, minutes: number, extra: Partial<ManhourDay> = {}): ManhourDay => ({
  date,
  closed: false,
  fixed: false,
  totalMinutes: minutes,
  projects:
    minutes > 0 ? [{ projectId: 1, totalMinutes: minutes, items: [{ taskId: 1, minutes }] }] : [],
  ...extra,
});

/** 09:00 出勤、12:00–13:00 休憩、18:00 退勤。実働 8:00、休憩 60 分。 */
function fullDay(date: string): Stamp[] {
  return [
    s('clock_in', `${date}T09:00:00+09:00`),
    s('break_start', `${date}T12:00:00+09:00`),
    s('break_end', `${date}T13:00:00+09:00`),
    s('clock_out', `${date}T18:00:00+09:00`),
  ];
}

function report(
  partial: Partial<CloseoutInput> & Pick<CloseoutInput, 'scope' | 'date' | 'month'>,
): CloseoutReport {
  return buildCloseout({
    today: partial.today ?? '2026-10-27',
    now: partial.now ?? new Date('2026-10-27T08:00:00Z'), // 17:00 JST
    thresholdHours: partial.thresholdHours ?? 45,
    records: partial.records ?? [],
    stamps: partial.stamps ?? [],
    manhours: partial.manhours ?? [],
    alerts: partial.alerts ?? [],
    scope: partial.scope,
    date: partial.date,
    month: partial.month,
    ...(partial.gaps ? { gaps: partial.gaps } : {}),
    ...(partial.readOnly ? { readOnly: true } : {}),
  });
}

const codes = (items: readonly CloseoutItem[]) => items.map((i) => i.code);
const on = (items: readonly CloseoutItem[], date: string) => items.filter((i) => i.date === date);

describe('requiredBreakMinutes', () => {
  it('6 時間ちょうどは 0、1 分超えたら 45 分。8 時間ちょうどは 45、1 分超えたら 60 分', () => {
    expect(requiredBreakMinutes(6 * 60)).toBe(0);
    expect(requiredBreakMinutes(6 * 60 + 1)).toBe(45);
    expect(requiredBreakMinutes(8 * 60)).toBe(45);
    expect(requiredBreakMinutes(8 * 60 + 1)).toBe(60);
    expect(requiredBreakMinutes(0)).toBe(0);
  });
});

describe('buildCloseout', () => {
  it('退勤済みで休憩・工数が足りていれば、対応は不要だと明言する', () => {
    const out = report({
      scope: 'day',
      date: '2026-10-27',
      month: '2026-10',
      stamps: fullDay('2026-10-27'),
      manhours: [mh('2026-10-27', 480)],
      records: [rec('2026-10-27', 'workday', 480)],
    });
    expect(out.ok).toBe(true);
    expect(out.readyToClose).toBe(true);
    expect(out.items).toEqual([]);
    expect(out.headline).toMatch(/対応は不要/);
    expect(out.timezone).toBe('Asia/Tokyo');
    expect(out.overtime.level).toBe('ok');
  });

  it('昼休みを打刻し忘れ、休憩が 3 分しかない日は、60 分必要なことと修正申請を返す', () => {
    // 09:00–12:00 勤務、12:00–12:03 休憩、12:03–18:00 勤務。実働 8:57、休憩 3 分。
    const out = report({
      scope: 'day',
      date: '2026-10-26',
      month: '2026-10',
      stamps: [
        s('clock_in', '2026-10-26T09:00:00+09:00'),
        s('break_start', '2026-10-26T12:00:00+09:00'),
        s('break_end', '2026-10-26T12:03:00+09:00'),
        s('clock_out', '2026-10-26T18:00:00+09:00'),
      ],
      manhours: [mh('2026-10-26', 537)],
      records: [rec('2026-10-26', 'workday', 537)],
    });
    const item = out.items.find((i) => i.code === 'short_break');
    expect(item).toMatchObject({ severity: 'error', date: '2026-10-26' });
    expect(item?.detail).toMatch(/3/);
    expect(item?.detail).toMatch(/60/);
    expect(item?.action).toMatch(/修正申請/);
    expect(item?.action).toMatch(/punch/);
    expect(item?.tool).toBeUndefined();
    expect(out.ok).toBe(false);
    expect(out.items[0]?.code).toBe('short_break');
  });

  it('6 時間 1 分で休憩 44 分は不足、45 分なら足りる。8 時間ちょうどは 45 分で足りる', () => {
    const day = (date: string, outAt: string, breakEnd: string): Pick<CloseoutReport, 'items'> =>
      report({
        scope: 'day',
        date,
        month: '2026-10',
        stamps: [
          s('clock_in', `${date}T09:00:00+09:00`),
          s('break_start', `${date}T12:00:00+09:00`),
          s('break_end', `${date}T${breakEnd}:00+09:00`),
          s('clock_out', `${date}T${outAt}:00+09:00`),
        ],
        manhours: [mh(date, 400)],
      });
    // 09:00–12:00 (180) + 12:44–16:01 (197) = 377 分 > 6h、休憩 44
    expect(codes(day('2026-10-20', '16:01', '12:44').items)).toContain('short_break');
    // 09:00–12:00 (180) + 12:45–16:01 (196) = 376、休憩 45
    expect(codes(day('2026-10-21', '16:01', '12:45').items)).not.toContain('short_break');
    // 09:00–12:00 (180) + 12:45–17:00 (255) = 435、休憩 45。8 時間未満なので 45 で足りる
    expect(codes(day('2026-10-22', '17:00', '12:45').items)).not.toContain('short_break');
  });

  it('未出勤の見出しは、休憩戻しや退勤を案内しない', () => {
    const out = report({
      scope: 'day',
      date: '2026-10-27',
      month: '2026-10',
      stamps: [],
    });
    expect(codes(out.items)).toContain('not_clocked_in');
    expect(out.headline).toMatch(/未出勤/);
    expect(out.headline).not.toMatch(/休憩を戻す|退勤してください/);
  });

  it('読み取り専用では punch を案内しない', () => {
    const out = report({
      scope: 'day',
      date: '2026-10-27',
      month: '2026-10',
      now: new Date('2026-10-27T06:00:00Z'),
      stamps: [s('clock_in', '2026-10-27T09:00:00+09:00')],
      readOnly: true,
    });
    expect(out.items.some((item) => item.tool === 'punch')).toBe(false);
    expect(out.items.find((item) => item.code === 'still_working')?.action).toMatch(/読み取り専用/);
  });

  it('休憩打刻が無い過去日は不足と断定せず、実働は実績の分数を使う', () => {
    const none = report({
      scope: 'day',
      date: '2026-10-20',
      month: '2026-10',
      stamps: [
        s('clock_in', '2026-10-20T09:00:00+09:00'),
        s('clock_out', '2026-10-20T20:34:00+09:00'),
      ],
      records: [rec('2026-10-20', 'workday', 634)],
      manhours: [mh('2026-10-20', 634)],
    });
    expect(codes(none.items)).not.toContain('short_break');
    const info = none.items.find((item) => item.code === 'no_break_punches');
    expect(info?.severity).toBe('info');
    expect(info?.detail).toMatch(/10:34/);
    expect(info?.detail).not.toMatch(/11:34/);

    const measured = report({
      scope: 'day',
      date: '2026-10-21',
      month: '2026-10',
      stamps: [
        s('clock_in', '2026-10-21T09:00:00+09:00'),
        s('break_start', '2026-10-21T12:00:00+09:00'),
        s('break_end', '2026-10-21T12:03:00+09:00'),
        s('clock_out', '2026-10-21T20:37:00+09:00'),
      ],
      records: [rec('2026-10-21', 'workday', 634)],
      manhours: [mh('2026-10-21', 634)],
    });
    const item = measured.items.find((entry) => entry.code === 'short_break');
    expect(item?.severity).toBe('error');
    expect(item?.detail).toMatch(/10:34/);
    expect(item?.detail).not.toMatch(/13:53|11:34/);
  });

  it('進行中の日は退勤漏れにせず、休憩中なら休憩戻を先に案内する', () => {
    const working = report({
      scope: 'day',
      date: '2026-10-27',
      month: '2026-10',
      now: new Date('2026-10-27T06:00:00Z'), // 15:00 JST
      stamps: [
        s('clock_in', '2026-10-27T09:00:00+09:00'),
        s('break_start', '2026-10-27T12:00:00+09:00'),
        s('break_end', '2026-10-27T13:00:00+09:00'),
      ],
      manhours: [mh('2026-10-27', 300)],
    });
    expect(codes(working.items)).not.toContain('missing_clock_out');
    expect(codes(working.items)).toContain('still_working');
    expect(working.todayStatus).toMatchObject({ state: 'working', stateLabel: '勤務中' });
    expect(working.readyToClose).toBe(false);
    const leave = working.items.find((i) => i.code === 'still_working');
    expect(leave?.tool).toBe('punch');
    expect(leave?.toolArgs).toEqual({ type: 'clock_out' });
    expect(leave?.severity).toBe('info');

    const onBreak = report({
      scope: 'day',
      date: '2026-10-27',
      month: '2026-10',
      now: new Date('2026-10-27T03:10:00Z'), // 12:10 JST、休憩 10 分、実働 3 時間
      stamps: [
        s('clock_in', '2026-10-27T09:00:00+09:00'),
        s('break_start', '2026-10-27T12:00:00+09:00'),
      ],
    });
    const open = onBreak.items.find((i) => i.code === 'open_break');
    expect(open).toMatchObject({
      severity: 'error',
      tool: 'punch',
      toolArgs: { type: 'break_end' },
    });
    expect(open?.action).not.toMatch(/修正申請/);
    expect(codes(onBreak.items)).not.toContain('missing_clock_out');
    expect(onBreak.todayStatus?.state).toBe('on_break');
  });

  it('勤務が 6 時間を超えていてまだ休憩中なら、足りるまで休憩を続けてから休憩戻', () => {
    // 09:00–15:30 で実働 6:30、15:30 から休憩 5 分。必要 45 分。
    const out = report({
      scope: 'day',
      date: '2026-10-27',
      month: '2026-10',
      now: new Date('2026-10-27T06:35:00Z'), // 15:35 JST
      stamps: [
        s('clock_in', '2026-10-27T09:00:00+09:00'),
        s('break_start', '2026-10-27T15:30:00+09:00'),
      ],
    });
    const item = out.items.find((i) => i.code === 'short_break');
    expect(item?.toolArgs).toEqual({ type: 'break_end' });
    expect(item?.action).toMatch(/45/);
    expect(item?.action).toMatch(/続け/);
    expect(codes(out.items)).not.toContain('open_break');
  });

  it('過去の退勤忘れは punch ではなく修正申請。16 時間以内の夜勤の続きは今 punch できる', () => {
    const past = report({
      scope: 'month',
      date: '2026-10-27',
      month: '2026-10',
      stamps: [s('clock_in', '2026-10-01T09:00:00+09:00')],
      records: [rec('2026-10-01', 'workday', 0)],
    });
    const missing = past.items.find((i) => i.code === 'missing_clock_out');
    expect(missing).toMatchObject({ date: '2026-10-01', severity: 'error' });
    expect(missing?.tool).toBeUndefined();
    expect(missing?.action).toMatch(/修正申請/);

    // 10/26 22:00 出勤のまま、10/27 06:00（8 時間後）。まだ punch clock_out で閉じられる。
    const overnight = report({
      scope: 'day',
      date: '2026-10-27',
      month: '2026-10',
      now: new Date('2026-10-26T21:00:00Z'), // 10/27 06:00 JST
      stamps: [s('clock_in', '2026-10-26T22:00:00+09:00')],
    });
    const open = overnight.items.find((i) => i.code === 'overnight_open');
    expect(open).toMatchObject({
      date: '2026-10-26',
      tool: 'punch',
      toolArgs: { type: 'clock_out' },
    });
    expect(open?.action).not.toMatch(/修正申請/);
    expect(codes(overnight.items)).not.toContain('not_clocked_in');
  });

  it('日付が日本時間で変わる直前と直後で、見る日が変わる', () => {
    const stamps = [s('clock_in', '2026-10-31T09:00:00+09:00')];
    const before = report({
      scope: 'day',
      date: '2026-10-31',
      month: '2026-10',
      today: '2026-10-31',
      now: new Date('2026-10-31T14:59:00Z'), // 23:59 JST
      stamps,
    });
    expect(before.date).toBe('2026-10-31');
    expect(codes(before.items)).toContain('still_working');
    expect(codes(before.items)).not.toContain('missing_clock_out');

    const after = report({
      scope: 'day',
      date: '2026-11-01',
      month: '2026-11',
      today: '2026-11-01',
      now: new Date('2026-10-31T15:30:00Z'), // 11/01 00:30 JST
      stamps,
    });
    expect(codes(on(after.items, '2026-10-31'))).not.toContain('missing_clock_out');
    // 09:00 から 00:30 は 15 時間 30 分で、16 時間以内なので今の punch で閉じる。
    expect(after.items.find((i) => i.code === 'overnight_open')?.toolArgs).toEqual({
      type: 'clock_out',
    });

    const tooLate = report({
      scope: 'month',
      date: '2026-11-01',
      month: '2026-10',
      today: '2026-11-01',
      now: new Date('2026-10-31T15:30:00Z'),
      stamps: [s('clock_in', '2026-10-31T08:00:00+09:00')],
    });
    const late = tooLate.items.find(
      (i) => i.date === '2026-10-31' && i.code === 'missing_clock_out',
    );
    expect(late?.tool).toBeUndefined();
    expect(late?.action).toMatch(/修正申請/);
    expect(codes(on(tooLate.items, '2026-11-01'))).not.toContain('missing_clock_out');
  });

  it('月初の月次では前月を混ぜない。月末の月次は当日を進行中として扱い、昨日までの漏れは出す', () => {
    const first = report({
      scope: 'month',
      date: '2026-11-01',
      month: '2026-11',
      today: '2026-11-01',
      now: new Date('2026-10-31T16:00:00Z'), // 11/01 01:00 JST
      stamps: [s('clock_in', '2026-10-31T08:00:00+09:00')],
      records: [rec('2026-10-31', 'workday', 480)],
    });
    expect(first.from).toBe('2026-11-01');
    expect(first.to).toBe('2026-11-01');
    expect(codes(first.items)).not.toContain('missing_clock_out');

    const end = report({
      scope: 'month',
      date: '2026-10-31',
      month: '2026-10',
      today: '2026-10-31',
      now: new Date('2026-10-31T08:00:00Z'), // 17:00 JST
      stamps: [s('clock_in', '2026-10-30T09:00:00+09:00'), ...fullDay('2026-10-31').slice(0, 3)],
      manhours: [mh('2026-10-31', 480)],
      records: [rec('2026-10-30', 'workday', 0), rec('2026-10-31', 'workday', 300)],
    });
    expect(end.from).toBe('2026-10-01');
    expect(end.to).toBe('2026-10-31');
    expect(on(end.items, '2026-10-30').some((i) => i.code === 'missing_clock_out')).toBe(true);
    expect(codes(on(end.items, '2026-10-31'))).not.toContain('missing_clock_out');
    expect(end.todayStatus?.state).toBe('working');
  });

  it('終わった日の工数が無い、または 15 分よりずれていると案内する。締め済みなら保存ツールは出さない', () => {
    const missing = report({
      scope: 'day',
      date: '2026-10-26',
      month: '2026-10',
      stamps: fullDay('2026-10-26'),
    });
    const miss = missing.items.find((i) => i.code === 'manhours_missing');
    expect(miss?.severity).toBe('warning');
    expect(miss?.tool).toBe('get_my_projects');
    expect(miss?.action).toMatch(/save_manhours/);

    const closeEnough = report({
      scope: 'day',
      date: '2026-10-26',
      month: '2026-10',
      stamps: fullDay('2026-10-26'),
      manhours: [mh('2026-10-26', 466)],
    });
    expect(codes(closeEnough.items)).not.toContain('manhours_mismatch');
    expect(codes(closeEnough.items)).not.toContain('manhours_missing');

    const off = report({
      scope: 'day',
      date: '2026-10-26',
      month: '2026-10',
      stamps: fullDay('2026-10-26'),
      manhours: [mh('2026-10-26', 440)],
    });
    const mismatch = off.items.find((i) => i.code === 'manhours_mismatch');
    expect(mismatch?.tool).toBe('get_manhours');
    expect(mismatch?.toolArgs).toEqual({ from: '2026-10-26', to: '2026-10-26' });

    const locked = report({
      scope: 'day',
      date: '2026-10-26',
      month: '2026-10',
      stamps: fullDay('2026-10-26'),
      manhours: [mh('2026-10-26', 0, { closed: true })],
    });
    const lockedItem = locked.items.find((i) => i.code === 'manhours_missing');
    expect(lockedItem?.tool).toBeUndefined();
    expect(lockedItem?.action).toMatch(/締め|確定/);
  });

  it('進行中で実働が 1 時間未満なら工数未入力では騒がない', () => {
    const out = report({
      scope: 'day',
      date: '2026-10-27',
      month: '2026-10',
      now: new Date('2026-10-27T00:30:00Z'), // 09:30 JST、実働 30 分
      stamps: [s('clock_in', '2026-10-27T09:00:00+09:00')],
    });
    expect(codes(out.items)).not.toContain('manhours_missing');
    expect(codes(out.items)).toContain('still_working');
  });

  it('残業の着地がしきい値を超えるときだけ項目にし、目安であることは残す', () => {
    const over = report({
      scope: 'month',
      date: '2026-10-27',
      month: '2026-10',
      thresholdHours: 1,
      records: [rec('2026-10-01', 'workday', 600)],
      stamps: fullDay('2026-10-01'),
      manhours: [mh('2026-10-01', 480)],
    });
    expect(over.overtime.level).toBe('over');
    expect(over.overtime.thresholdHours).toBe(1);
    expect(codes(over.items)).toContain('overtime_over');
    expect(over.disclaimer).toMatch(/目安/);

    const fine = report({
      scope: 'day',
      date: '2026-10-26',
      month: '2026-10',
      stamps: fullDay('2026-10-26'),
      manhours: [mh('2026-10-26', 480)],
      records: [rec('2026-10-26', 'workday', 480)],
    });
    expect(fine.overtime.level).toBe('ok');
    expect(codes(fine.items).some((c) => c.startsWith('overtime_'))).toBe(false);
  });

  it('同じ内容のアラートは重複させず、それ以外は次の行動つきで残す', () => {
    const alerts: Alert[] = [
      { month: '2026-10', date: '2026-10-26', type: 28, label: '休憩時間不足' },
      { month: '2026-10', date: '2026-10-26', type: 7, label: '遅刻' },
      { month: '2026-10', type: 13, label: '36協定' },
    ];
    const out = report({
      scope: 'day',
      date: '2026-10-26',
      month: '2026-10',
      stamps: [
        s('clock_in', '2026-10-26T09:00:00+09:00'),
        s('break_start', '2026-10-26T12:00:00+09:00'),
        s('break_end', '2026-10-26T12:03:00+09:00'),
        s('clock_out', '2026-10-26T18:00:00+09:00'),
      ],
      manhours: [mh('2026-10-26', 537)],
      alerts,
    });
    expect(out.alerts.alreadyCovered).toBeGreaterThanOrEqual(1);
    expect(out.items.filter((i) => i.code === 'short_break')).toHaveLength(1);
    const late = out.items.find((i) => i.code === 'alert' && i.title.includes('遅刻'));
    expect(late?.date).toBe('2026-10-26');
    expect(late?.action).toMatch(/修正申請/);
    expect(out.alerts.listed).toBeGreaterThanOrEqual(1);
  });

  it('休憩不足は工数より先、工数は残業の注意より先', () => {
    const out = report({
      scope: 'day',
      date: '2026-10-26',
      month: '2026-10',
      thresholdHours: 1,
      stamps: [
        s('clock_in', '2026-10-26T09:00:00+09:00'),
        s('clock_out', '2026-10-26T18:00:00+09:00'),
      ],
      records: [rec('2026-10-26', 'workday', 540)],
    });
    const order = codes(out.items);
    expect(order.indexOf('short_break')).toBeLessThan(order.indexOf('manhours_missing'));
    expect(order.indexOf('manhours_missing')).toBeLessThan(order.indexOf('overtime_over'));
    expect(out.items[0]?.priority).toBe(1);
  });

  it('範囲の翌朝の退勤があれば、末日の夜勤を打刻漏れにしない', () => {
    const out = report({
      scope: 'month',
      date: '2026-11-02',
      month: '2026-10',
      today: '2026-11-02',
      now: new Date('2026-11-02T01:00:00Z'),
      stamps: [
        s('clock_in', '2026-10-31T22:00:00+09:00'),
        s('clock_out', '2026-11-01T06:00:00+09:00'),
      ],
      records: [rec('2026-10-31', 'workday', 480)],
    });
    expect(codes(out.items)).not.toContain('missing_clock_out');
    expect(codes(out.items)).not.toContain('missing_clock_in');
    expect(codes(out.items)).not.toContain('overnight_open');
  });

  it('日付をまたぐ休憩は、翌朝の休憩戻と退勤があれば打刻漏れにしない', () => {
    const out = report({
      scope: 'day',
      date: '2026-10-31',
      month: '2026-10',
      today: '2026-11-01',
      now: new Date('2026-11-01T01:00:00Z'),
      stamps: [
        s('clock_in', '2026-10-31T22:00:00+09:00'),
        s('break_start', '2026-10-31T23:50:00+09:00'),
        s('break_end', '2026-11-01T00:10:00+09:00'),
        s('clock_out', '2026-11-01T06:00:00+09:00'),
      ],
    });
    expect(codes(out.items)).not.toContain('missing_break_end');
    expect(codes(out.items)).not.toContain('missing_clock_out');
    expect(codes(out.items)).not.toContain('open_break');
  });
});
