import { describe, expect, it } from 'vitest';
import { parseStamps, STAMP_TYPE_CODES, type Stamp, type StampType } from '../../src/api/stamps.ts';
import { computeDayStatus } from '../../src/domain/day-status.ts';

const at = (hms: string) => new Date(`2026-10-27T${hms}+09:00`);
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

  it('3 分の休憩の直後、端数を区間ごとに捨てると短く見える例は 54 分のまま', () => {
    // 09:00:05 出勤、09:54:20 休憩入、09:57:20 休憩戻、09:57:50 現在。
    // 勤務は 54 分 45 秒なので 54 分。休憩はちょうど 3 分。休憩後の 30 秒は次の分に届かない。
    const r = computeDayStatus(
      [s('clock_in', '09:00:05'), s('break_start', '09:54:20'), s('break_end', '09:57:20')],
      at('09:57:50'),
    );
    expect(r).toMatchObject({ state: 'working', workedMinutes: 54, breakMinutes: 3 });
  });

  it('休憩のあとの勤務も今まで足し、端数は区間ごとに捨てない', () => {
    // 54 分 30 秒 + 40 秒 = 55 分 10 秒。区間ごとに切り捨てると 54。休憩終了時刻で止めると 54。
    const r = computeDayStatus(
      [s('clock_in', '09:00:00'), s('break_start', '09:54:30'), s('break_end', '09:57:30')],
      at('09:58:10'),
    );
    expect(r).toMatchObject({ state: 'working', workedMinutes: 55, breakMinutes: 3 });
  });

  it('API の yyyy/mm/dd HH:MM:SS でも、同じ切り捨ての結果になる', () => {
    const stamps = parseStamps({
      stamps: [
        { stamped_at: '2026/10/27 09:00:05', type: 11, timezone: '+9.00' },
        { stamped_at: '2026/10/27 09:54:20', type: 31, timezone: '+9.00' },
        { stamped_at: '2026/10/27 09:57:20', type: 32, timezone: '+9.00' },
      ],
    });
    expect(computeDayStatus(stamps, at('09:57:50'))).toMatchObject({
      state: 'working',
      workedMinutes: 54,
      breakMinutes: 3,
    });
  });

  it('未知の打刻は状態も時間も変えない', () => {
    const unknown: Stamp = {
      type: 'unknown',
      typeCode: 99,
      stampedAt: at('10:00'),
      attributes: {},
    };
    expect(computeDayStatus([s('clock_in', '09:00'), unknown], at('11:00'))).toMatchObject({
      state: 'working',
      workedMinutes: 120,
    });
  });

  it('今より先の打刻でも勤務時間は負にならない', () => {
    expect(computeDayStatus([s('clock_in', '10:00')], at('09:00'))).toMatchObject({
      state: 'working',
      workedMinutes: 0,
      breakMinutes: 0,
    });
  });

  it('休憩中に退勤したら、休憩はそこまで', () => {
    const r = computeDayStatus(
      [s('clock_in', '09:00'), s('break_start', '12:00'), s('clock_out', '12:30')],
      at('15:00'),
    );
    expect(r).toMatchObject({ state: 'finished', workedMinutes: 180, breakMinutes: 30 });
  });
});
