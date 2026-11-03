import { describe, expect, it } from 'vitest';
import { STAMP_TYPE_CODES, type Stamp, type StampType } from '../../src/api/stamps.ts';
import type { WorkingRecord } from '../../src/api/working-records.ts';
import {
  buildTeamCloseout,
  type TeamCloseoutInput,
  type TeamCloseoutReport,
} from '../../src/domain/team-close-out.ts';
import { teamCloseoutOutputSchema } from '../../src/tools/team-close-out.ts';

const stamp = (staffId: number, type: StampType, iso: string): Stamp => ({
  staffId,
  type,
  typeCode: STAMP_TYPE_CODES[type],
  stampedAt: new Date(iso),
  attributes: {},
});

const finished = (staffId: number, date: string): Stamp[] => [
  stamp(staffId, 'clock_in', `${date}T09:00:00+09:00`),
  stamp(staffId, 'break_start', `${date}T12:00:00+09:00`),
  stamp(staffId, 'break_end', `${date}T13:00:00+09:00`),
  stamp(staffId, 'clock_out', `${date}T18:00:00+09:00`),
];

function input(partial: Partial<TeamCloseoutInput> = {}): TeamCloseoutReport {
  return buildTeamCloseout({
    scope: 'month',
    today: '2026-10-27',
    date: '2026-10-27',
    month: '2026-10',
    thresholdHours: 45,
    members: [{ staffId: 1, name: '架空 花子', staffNum: 'A001' }],
    records: [],
    stamps: [],
    recordsOk: true,
    stampsOk: true,
    ...partial,
  });
}

const codes = (report: TeamCloseoutReport) =>
  report.members.flatMap((m) => m.days.map((d) => d.code));

describe('buildTeamCloseout', () => {
  it('残件が無ければ、対応は不要だと明言する', () => {
    const out = input({
      records: [
        {
          staffId: 1,
          date: '2026-10-01',
          dayCategory: 'workday',
          actualWorkingMinutes: 480,
        },
      ],
      stamps: finished(1, '2026-10-01'),
    });
    expect(out.ok).toBe(true);
    expect(out.headline).toMatch(/対応は不要/);
    expect(out.members).toEqual([]);
    expect(out.noActivity).toEqual([]);
    expect(out.noIssueCount).toBe(1);
    expect(out.needsActionCount).toBe(0);
    expect(out.unsupported.join('\n')).toMatch(/アラート/);
    expect(out.unsupported.join('\n')).toMatch(/工数/);
    expect(out.overtimeThresholds).toEqual({ limitHours: 45, watchHours: 36 });
    expect(teamCloseoutOutputSchema.strict().safeParse(out).success).toBe(true);
  });

  it('同姓同名でも staffId と社員番号を出し、実績も打刻も無い人は別にする', () => {
    const out = input({
      members: [
        { staffId: 2, name: '架空 花子', staffNum: 'A002' },
        { staffId: 1, name: '架空 花子', staffNum: 'A001' },
        { staffId: 3, name: '試験 次郎', staffNum: 'B010' },
      ],
      records: [
        { staffId: 3, date: '2026-10-01', dayCategory: 'workday', actualWorkingMinutes: 480 },
      ],
      stamps: finished(3, '2026-10-01'),
    });
    expect(out.ok).toBe(false);
    expect(out.noIssueCount).toBe(1);
    expect(out.needsActionCount).toBe(0);
    expect(out.noActivity.map((p) => [p.staffId, p.name, p.staffNum])).toEqual([
      [1, '架空 花子', 'A001'],
      [2, '架空 花子', 'A002'],
    ]);
    expect(out.headline).toMatch(/2 人/);
    expect(out.noActivity[0]?.note).toMatch(/休職/);
  });

  it('退勤打刻があれば漏れにせず、開始・終了だけでは退勤打刻なしにする', () => {
    const at = (iso: string) => new Date(iso);
    const corrected = input({
      records: [
        {
          staffId: 1,
          date: '2026-10-01',
          dayCategory: 'workday',
          actualWorkingMinutes: 480,
          startTime: at('2026-10-01T09:00:00+09:00'),
          endTime: at('2026-10-01T18:00:00+09:00'),
          clockOutAt: at('2026-10-01T18:00:00+09:00'),
        },
      ],
      stamps: [stamp(1, 'clock_in', '2026-10-01T09:00:00+09:00')],
    });
    expect(codes(corrected)).not.toContain('missing_clock_out');

    const open = input({
      records: [
        { staffId: 1, date: '2026-10-01', dayCategory: 'workday', actualWorkingMinutes: 0 },
      ],
      stamps: [stamp(1, 'clock_in', '2026-10-01T09:00:00+09:00')],
    });
    expect(codes(open)).toContain('missing_clock_out');
    expect(open.members[0]?.days.find((d) => d.code === 'missing_clock_out')?.detail).not.toMatch(
      /23:59|14:59/,
    );
  });

  it('出勤の重複と、出勤無しの休憩戻・退勤を指摘する', () => {
    const out = input({
      stamps: [
        stamp(1, 'clock_in', '2026-10-01T09:00:00+09:00'),
        stamp(1, 'clock_in', '2026-10-01T09:05:00+09:00'),
        stamp(1, 'break_start', '2026-10-01T12:00:00+09:00'),
        stamp(1, 'break_end', '2026-10-01T13:00:00+09:00'),
        stamp(1, 'clock_out', '2026-10-01T18:00:00+09:00'),
        stamp(1, 'break_end', '2026-10-02T12:00:00+09:00'),
        stamp(1, 'clock_out', '2026-10-02T18:00:00+09:00'),
      ],
    });
    expect(codes(out)).toEqual(['duplicate_clock_in', 'missing_clock_in']);
    expect(out.members[0]?.staffId).toBe(1);
    expect(out.members[0]?.staffNum).toBe('A001');
  });

  it('夜勤と日をまたぐ休憩は、短い休憩や出勤漏れにしない', () => {
    const out = input({
      stamps: [
        stamp(1, 'clock_in', '2026-10-01T22:00:00+09:00'),
        stamp(1, 'break_start', '2026-10-01T23:30:00+09:00'),
        stamp(1, 'break_end', '2026-10-02T00:30:00+09:00'),
        stamp(1, 'clock_out', '2026-10-02T06:00:00+09:00'),
        stamp(1, 'clock_in', '2026-10-02T22:00:00+09:00'),
        stamp(1, 'clock_out', '2026-10-03T04:00:00+09:00'),
      ],
    });
    expect(codes(out)).not.toContain('short_break');
    expect(codes(out)).not.toContain('missing_clock_in');
    expect(codes(out)).not.toContain('missing_clock_out');
    expect(codes(out)).not.toContain('missing_break_end');
    expect(codes(out)).not.toContain('short_interval');
    expect(out.members).toEqual([]);
  });

  it('日をまたぐ勤務で休憩が 3 分なら開始日だけを休憩不足にし、翌日は重複して出さない', () => {
    const out = input({
      stamps: [
        stamp(1, 'clock_in', '2026-10-01T20:00:00+09:00'),
        stamp(1, 'break_start', '2026-10-01T23:00:00+09:00'),
        stamp(1, 'break_end', '2026-10-01T23:03:00+09:00'),
        stamp(1, 'clock_out', '2026-10-02T05:03:00+09:00'),
      ],
    });
    const breaks = out.members[0]?.days.filter((d) => d.code === 'short_break') ?? [];
    expect(breaks.map((d) => d.date)).toEqual(['2026-10-01']);
    expect(breaks[0]?.detail).toMatch(/60/);
  });

  it('退勤して昼休みを取った日は、間の時間を休憩にして不足にしない。休憩ゼロは不足', () => {
    const split = input({
      stamps: [
        stamp(1, 'clock_in', '2026-10-01T09:00:00+09:00'),
        stamp(1, 'clock_out', '2026-10-01T12:00:00+09:00'),
        stamp(1, 'clock_in', '2026-10-01T13:00:00+09:00'),
        stamp(1, 'clock_out', '2026-10-01T18:00:00+09:00'),
      ],
    });
    expect(codes(split)).not.toContain('short_break');
    expect(codes(split)).not.toContain('duplicate_clock_in');

    const none = input({
      stamps: [
        stamp(1, 'clock_in', '2026-10-01T09:00:00+09:00'),
        stamp(1, 'clock_out', '2026-10-01T18:00:00+09:00'),
      ],
    });
    expect(codes(none)).not.toContain('short_break');
  });

  it('実績の開始終了や別日の退勤では打刻漏れを消さず、実働は拘束時間にしない', () => {
    const at = (iso: string) => new Date(iso);
    const missed = input({
      scope: 'month',
      records: [
        {
          staffId: 1,
          date: '2026-10-09',
          dayCategory: 'workday',
          actualWorkingMinutes: 634,
          startTime: at('2026-10-09T09:00:00+09:00'),
          endTime: at('2026-10-09T19:00:00+09:00'),
          clockOutAt: at('2026-10-13T17:51:00+09:00'),
        },
        {
          staffId: 1,
          date: '2026-10-10',
          dayCategory: 'workday',
          actualWorkingMinutes: 480,
          startTime: at('2026-10-10T09:12:00+09:00'),
        },
      ],
      stamps: [
        stamp(1, 'clock_in', '2026-10-09T09:00:00+09:00'),
        stamp(1, 'clock_out', '2026-10-10T18:00:00+09:00'),
      ],
    });
    const dayCodes = missed.members[0]?.days.map((d) => `${d.date} ${d.code}`);
    expect(dayCodes).toContain('2026-10-09 missing_clock_out');
    expect(dayCodes).toContain('2026-10-10 missing_clock_in');
    expect(missed.members[0]?.days.find((d) => d.date === '2026-10-09')?.detail).toMatch(
      /2026-10-13/,
    );

    const oneDay = input({
      scope: 'day',
      date: '2026-10-09',
      records: [
        {
          staffId: 1,
          date: '2026-10-09',
          dayCategory: 'workday',
          actualWorkingMinutes: 634,
          endTime: at('2026-10-09T19:00:00+09:00'),
        },
      ],
      stamps: [stamp(1, 'clock_in', '2026-10-09T09:00:00+09:00')],
    });
    expect(codes(oneDay)).toContain('missing_clock_out');

    const noisy = input({
      records: [
        {
          staffId: 1,
          date: '2026-10-01',
          dayCategory: 'workday',
          actualWorkingMinutes: 634,
        },
      ],
      stamps: [
        stamp(1, 'clock_in', '2026-10-01T09:00:00+09:00'),
        stamp(1, 'clock_out', '2026-10-01T20:34:00+09:00'),
      ],
    });
    expect(codes(noisy)).not.toContain('short_break');

    const short = input({
      records: [
        {
          staffId: 1,
          date: '2026-10-01',
          dayCategory: 'workday',
          actualWorkingMinutes: 634,
        },
      ],
      stamps: [
        stamp(1, 'clock_in', '2026-10-01T09:00:00+09:00'),
        stamp(1, 'break_start', '2026-10-01T12:00:00+09:00'),
        stamp(1, 'break_end', '2026-10-01T12:03:00+09:00'),
        stamp(1, 'clock_out', '2026-10-01T20:37:00+09:00'),
      ],
    });
    const item = short.members[0]?.days.find((d) => d.code === 'short_break');
    expect(item?.severity).toBe('error');
    expect(item?.detail).toMatch(/10:34/);
    expect(item?.detail).not.toMatch(/11:34|13:53/);
  });

  it('打刻の休憩が 3 分なら不足、60 分なら足りる。休憩実績があればそちらを使う', () => {
    const short = input({
      stamps: [
        stamp(1, 'clock_in', '2026-10-01T09:00:00+09:00'),
        stamp(1, 'break_start', '2026-10-01T12:00:00+09:00'),
        stamp(1, 'break_end', '2026-10-01T12:03:00+09:00'),
        stamp(1, 'clock_out', '2026-10-01T18:00:00+09:00'),
      ],
    });
    expect(codes(short)).toContain('short_break');

    const enough = input({ stamps: finished(1, '2026-10-01') });
    expect(codes(enough)).not.toContain('short_break');

    const fromRecord = input({
      records: [
        {
          staffId: 1,
          date: '2026-10-01',
          dayCategory: 'workday',
          actualWorkingMinutes: 540,
          workingMinutesAreGross: true,
          breakMinutes: 60,
        },
      ],
      stamps: [
        stamp(1, 'clock_in', '2026-10-01T09:00:00+09:00'),
        stamp(1, 'break_start', '2026-10-01T12:00:00+09:00'),
        stamp(1, 'break_end', '2026-10-01T12:03:00+09:00'),
        stamp(1, 'clock_out', '2026-10-01T18:00:00+09:00'),
      ],
    });
    expect(codes(fromRecord)).not.toContain('short_break');
  });

  it('経過 9 時間で休憩が不明な日は、法定 60 分を引いて残業の目安を出さず、休憩不足にもしない', () => {
    const records: WorkingRecord[] = Array.from({ length: 10 }, (_, i) => ({
      staffId: 1,
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      dayCategory: 'workday',
      actualWorkingMinutes: 540,
      workingMinutesAreGross: true,
    }));
    const out = input({ records });
    expect(out.members).toEqual([]);
    expect(out.breakTimeUnknown).toBe(true);
    expect(out.disclaimer).toMatch(/見積もり/);
    expect(out.ok).toBe(true);
  });

  it('残業の目安は 36 時間と 45 時間の両方を書く', () => {
    const out = input({
      records: [
        {
          staffId: 1,
          date: '2026-10-01',
          dayCategory: 'workday',
          actualWorkingMinutes: 480 + 46 * 60,
        },
      ],
      stamps: finished(1, '2026-10-01'),
    });
    expect(out.members[0]?.overtime?.level).toBe('over');
    expect(out.members[0]?.overtime?.detail).toMatch(/36/);
    expect(out.members[0]?.overtime?.detail).toMatch(/45/);
    expect(out.ok).toBe(false);
  });

  it('今日の出勤中は退勤漏れにしない', () => {
    const out = input({
      scope: 'day',
      date: '2026-10-27',
      stamps: [stamp(1, 'clock_in', '2026-10-27T09:00:00+09:00')],
    });
    expect(codes(out)).not.toContain('missing_clock_out');
    expect(out.note).toMatch(/進行中/);
    expect(out.ok).toBe(true);
  });

  it('打刻が取れないときは、打刻ゼロを欠勤扱いにしない', () => {
    const out = input({
      recordsOk: true,
      stampsOk: false,
      gaps: ['get_team_stamps failed'],
      records: [
        { staffId: 1, date: '2026-10-01', dayCategory: 'workday', actualWorkingMinutes: 0 },
      ],
    });
    expect(codes(out)).not.toContain('no_punches_on_workday');
    expect(out.noActivity).toEqual([]);
    expect(out.ok).toBe(false);
    expect(out.headline).toMatch(/断定できません/);
  });

  it('管理下がいなければ、その旨を返す', () => {
    const out = input({ members: [] });
    expect(out.headline).toMatch(/従業員がいません/);
    expect(out.ok).toBe(false);
    expect(out.staffCount).toBe(0);
  });

  it('日の指定は、その日以外の残件を混ぜない', () => {
    const out = input({
      scope: 'day',
      date: '2026-10-02',
      stamps: [stamp(1, 'clock_in', '2026-10-01T09:00:00+09:00'), ...finished(1, '2026-10-02')],
    });
    expect(codes(out)).not.toContain('missing_clock_out');
    expect(out.date).toBe('2026-10-02');
    expect(out.members).toEqual([]);
  });
});
