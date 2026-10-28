import { describe, expect, it } from 'vitest';
import { STAMP_TYPE_CODES, type Stamp, type StampType } from '../../src/api/stamps.ts';
import { computeDayStatus } from '../../src/domain/day-status.ts';

const at = (hhmm: string) => new Date(`2026-10-27T${hhmm}:00+09:00`);
const s = (type: StampType, hhmm: string): Stamp => ({
  type,
  typeCode: STAMP_TYPE_CODES[type],
  stampedAt: at(hhmm),
  attributes: {},
});

describe('computeDayStatus', () => {
  it('打刻がなければ未出勤', () => {
    expect(computeDayStatus([], at('10:00'))).toMatchObject({
      state: 'not_started',
      workedMinutes: 0,
      breakMinutes: 0,
    });
  });

  it('出勤後は勤務中で、今までの時間を数える', () => {
    expect(computeDayStatus([s('clock_in', '09:00')], at('11:30'))).toMatchObject({
      state: 'working',
      workedMinutes: 150,
      firstClockInAt: at('09:00'),
    });
  });

  it('休憩中は休憩時間を除く', () => {
    const r = computeDayStatus([s('clock_in', '09:00'), s('break_start', '12:00')], at('12:20'));
    expect(r).toMatchObject({ state: 'on_break', workedMinutes: 180, breakMinutes: 20 });
  });

  it('退勤済みは退勤時刻までで締める', () => {
    const r = computeDayStatus(
      [
        s('clock_in', '09:00'),
        s('break_start', '12:00'),
        s('break_end', '13:00'),
        s('clock_out', '18:00'),
      ],
      at('22:00'),
    );
    expect(r).toMatchObject({
      state: 'finished',
      workedMinutes: 480,
      breakMinutes: 60,
      lastClockOutAt: at('18:00'),
    });
  });

  it('直行・直帰も出勤・退勤として扱う', () => {
    const r = computeDayStatus([s('direct_in', '08:00'), s('direct_out', '17:00')], at('20:00'));
    expect(r).toMatchObject({ state: 'finished', workedMinutes: 540 });
  });

  it('退勤後の再出勤は勤務中に戻り、時間を足す', () => {
    const r = computeDayStatus(
      [s('clock_in', '09:00'), s('clock_out', '12:00'), s('clock_in', '20:00')],
      at('21:00'),
    );
    expect(r).toMatchObject({ state: 'working', workedMinutes: 240 });
  });

  it('二重の出勤など、ありえない並びは無視する（時間を二重に数えない）', () => {
    const r = computeDayStatus([s('clock_in', '09:00'), s('clock_in', '10:00')], at('11:00'));
    expect(r).toMatchObject({ state: 'working', workedMinutes: 120 });
  });

  it('休憩中に退勤したら、休憩はそこまで', () => {
    const r = computeDayStatus(
      [s('clock_in', '09:00'), s('break_start', '12:00'), s('clock_out', '12:30')],
      at('15:00'),
    );
    expect(r).toMatchObject({ state: 'finished', workedMinutes: 180, breakMinutes: 30 });
  });
});
