import { describe, expect, it } from 'vitest';
import { attendanceGuide } from '../../src/domain/guide.ts';
import { getAttendanceGuideTool } from '../../src/tools/guide.ts';

describe('get_attendance_guide', () => {
  it('法定休憩と打刻種別を、リソースと同じ関数で返す', async () => {
    const guide = attendanceGuide();
    expect(await getAttendanceGuideTool.handler({}, {} as never)).toEqual(guide);
    expect(guide.statutoryBreak.examples).toEqual([
      { workedMinutes: 360, requiredBreakMinutes: 0 },
      { workedMinutes: 361, requiredBreakMinutes: 45 },
      { workedMinutes: 480, requiredBreakMinutes: 45 },
      { workedMinutes: 481, requiredBreakMinutes: 60 },
    ]);
    expect(guide.statutoryBreak.rule).toMatch(/45/);
    expect(guide.statutoryBreak.rule).toMatch(/60/);
    expect(guide.stampTypes.map((stamp) => stamp.type)).toEqual([
      'clock_in',
      'clock_out',
      'direct_in',
      'direct_out',
      'break_start',
      'break_end',
    ]);
    expect(guide.stampTypes.find((stamp) => stamp.type === 'clock_in')).toMatchObject({
      label: '出勤',
      code: 11,
    });
    expect(guide.punch.correction).toMatch(/修正申請/);
  });
});
