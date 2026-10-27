import { describe, expect, it } from 'vitest';
import { parseStamps, STAMP_TYPE_CODES, stampTypeFromCode } from '../../src/api/stamps.ts';

describe('stampTypeFromCode', () => {
  it('打刻種別のコードを名前にする', () => {
    expect(stampTypeFromCode(11)).toBe('clock_in');
    expect(stampTypeFromCode(12)).toBe('clock_out');
    expect(stampTypeFromCode(21)).toBe('direct_in');
    expect(stampTypeFromCode(22)).toBe('direct_out');
    expect(stampTypeFromCode(31)).toBe('break_start');
    expect(stampTypeFromCode(32)).toBe('break_end');
    expect(stampTypeFromCode(99)).toBe('unknown');
    expect(STAMP_TYPE_CODES.clock_in).toBe(11);
  });
});

describe('parseStamps', () => {
  const raw = {
    login_company_code: 'acme',
    staff_id: 7,
    stamps: [
      {
        stamped_at: '2026/10/27 12:00:00',
        type: 31,
        local_time: '2026/10/27 12:00:00',
        timezone: '+09:00',
        attributes: {
          method: 1,
          org_id: 3,
          workplace_id: null,
          latitude: 35.1,
          longitude: 139.1,
          ip: '192.0.2.1',
        },
      },
      { stamped_at: '2026/10/27 09:01:00', type: 11, attributes: { method: 1 } },
      { stamped_at: 'broken', type: 12 },
    ],
  };

  it('時刻順に並べ、日時を Date にし、読めないものは捨てる', () => {
    const stamps = parseStamps(raw);
    expect(stamps.map((s) => s.type)).toEqual(['clock_in', 'break_start']);
    expect(stamps[0]?.stampedAt.toISOString()).toBe('2026-10-27T00:01:00.000Z');
    expect(stamps[1]).toMatchObject({
      typeCode: 31,
      staffId: 7,
      attributes: { method: 1, org_id: 3, latitude: 35.1 },
    });
  });

  it('配列そのものや、従業員ごとの配列も受け付ける', () => {
    expect(parseStamps(raw.stamps)).toHaveLength(2);
    const multi = [
      { staff_id: 1, stamps: [{ stamped_at: '2026/10/27 09:00:00', type: 11 }] },
      { staff_id: 2, stamps: [{ stamped_at: '2026/10/27 08:00:00', type: 11 }] },
    ];
    const stamps = parseStamps(multi);
    expect(stamps.map((s) => s.staffId)).toEqual([2, 1]);
    expect(parseStamps({ staffs: multi })).toHaveLength(2);
  });

  it('空や null は空配列', () => {
    expect(parseStamps(null)).toEqual([]);
    expect(parseStamps({ stamps: [] })).toEqual([]);
  });
});
