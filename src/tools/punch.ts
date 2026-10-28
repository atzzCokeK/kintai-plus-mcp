import * as z from 'zod/v4';
import { STAMP_TYPE_CODES, STAMP_TYPE_LABEL, type StampType } from '../api/stamps.ts';
import { computeDayStatus, DAY_STATE_LABEL } from '../domain/day-status.ts';
import { checkPunch } from '../domain/punch-check.ts';
import { formatIsoDateTime, todayInTokyo } from '../time/datetime.ts';
import { defineTool } from './registry.ts';
import { ToolInputError, ToolRefusedError } from './result.ts';

const STAMP_TYPES = Object.keys(STAMP_TYPE_CODES) as [StampType, ...StampType[]];

export const punchTool = defineTool({
  name: 'punch',
  title: 'Punch the time clock',
  description:
    'Record a punch (打刻) now: clock_in (出勤), clock_out (退勤), direct_in (直行), direct_out (直帰), break_start (休憩入), break_end (休憩戻). ' +
    'The type is required. The punch is recorded at the time Kintai Plus receives it and CANNOT be edited or deleted via the API ' +
    '(corrections need a request in the web UI), so confirm the type with the user if unsure. ' +
    "Punches that conflict with today's history (e.g. clock_in when already clocked in) are refused; pass force: true only if the user insists.",
  inputSchema: z.object({
    type: z.enum(STAMP_TYPES).describe('Punch type.'),
    telework: z
      .boolean()
      .optional()
      .describe('Mark as telework (テレワーク). Only valid with clock_in.'),
    force: z
      .boolean()
      .optional()
      .describe(
        "Punch even if it conflicts with today's punch history. Use only when the user explicitly asks.",
      ),
  }),
  capability: 'stamps.write',
  audience: 'everyone',
  kind: 'write',
  handler: async (input, ctx) => {
    if (input.telework && input.type !== 'clock_in') {
      throw new ToolInputError('telework can only be set with clock_in (出勤).');
    }
    const now = ctx.now();
    const today = todayInTokyo(now);
    const { stamps } = await ctx.backend.getStamps({ from: today, to: today });
    const before = computeDayStatus(stamps, now);
    const check = checkPunch(before.state, input.type);
    if (!check.ok && !input.force) {
      throw new ToolRefusedError(
        `Punch refused: ${check.reason}`,
        'Nothing was recorded. Check get_today_status. If the user really wants this punch ' +
          '(e.g. a shift that started yesterday), call punch again with force: true.',
        {
          state: before.state,
          stateLabel: DAY_STATE_LABEL[before.state],
          lastPunch: before.lastStamp
            ? {
                type: before.lastStamp.type,
                stampedAt: formatIsoDateTime(before.lastStamp.stampedAt),
              }
            : null,
        },
      );
    }

    await ctx.confirm(
      `Punch ${STAMP_TYPE_LABEL[input.type]} (${input.type})${input.telework ? '・テレワーク' : ''} now? ` +
        'It is recorded at the current time and cannot be edited via the API.' +
        (check.ok ? '' : ` Warning: ${check.reason}`),
    );
    const result = await ctx.backend.punch({
      type: input.type,
      at: now,
      ...(input.telework ? { telework: true } : {}),
    });
    const stampedAt = result.stampedAt ?? now;
    const after = computeDayStatus(
      [
        ...stamps,
        { type: input.type, typeCode: STAMP_TYPE_CODES[input.type], stampedAt, attributes: {} },
      ],
      stampedAt,
    );
    return {
      punched: input.type,
      typeLabel: STAMP_TYPE_LABEL[input.type],
      stampedAt: formatIsoDateTime(stampedAt),
      ...(input.telework ? { telework: true } : {}),
      ...(check.ok ? {} : { forced: true, conflict: check.reason }),
      previousState: before.state,
      newState: after.state,
      newStateLabel: DAY_STATE_LABEL[after.state],
      note: 'Recorded at the time Kintai Plus received it. It cannot be edited via the API; corrections need a request (申請) in the web UI.',
    };
  },
});
