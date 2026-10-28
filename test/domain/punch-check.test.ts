import { describe, expect, it } from 'vitest';
import type { StampType } from '../../src/api/stamps.ts';
import type { DayState } from '../../src/domain/day-status.ts';
import { checkPunch } from '../../src/domain/punch-check.ts';

describe('checkPunch', () => {
  const allowed: Array<[DayState, StampType]> = [
    ['not_started', 'clock_in'],
    ['not_started', 'direct_in'],
    ['working', 'break_start'],
    ['working', 'clock_out'],
    ['working', 'direct_out'],
    ['on_break', 'break_end'],
  ];
  it.each(allowed)('%s のとき %s は OK', (state, type) => {
    expect(checkPunch(state, type)).toEqual({ ok: true });
  });

  const conflicts: Array<[DayState, StampType, RegExp]> = [
    ['working', 'clock_in', /already/i],
    ['on_break', 'clock_in', /already/i],
    ['not_started', 'clock_out', /not clocked in/i],
    ['not_started', 'break_start', /not clocked in/i],
    ['working', 'break_end', /not on a break/i],
    ['on_break', 'clock_out', /on a break/i],
    ['on_break', 'break_start', /already on a break/i],
    ['finished', 'clock_in', /already clocked out/i],
    ['finished', 'clock_out', /already clocked out/i],
  ];
  it.each(conflicts)('%s のとき %s は矛盾', (state, type, reason) => {
    const r = checkPunch(state, type);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });
});
