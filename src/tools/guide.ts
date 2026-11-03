import * as z from 'zod/v4';
import { attendanceGuide } from '../domain/guide.ts';
import { defineTool } from './registry.ts';

export const getAttendanceGuideTool = defineTool({
  name: 'get_attendance_guide',
  title: 'Explain attendance rules and punch types',
  description:
    'Static rules for this server (not your live data): punch types (打刻種別: 出勤 clock_in, 退勤 clock_out, 直行 direct_in, 直帰 direct_out, 休憩入 break_start, 休憩戻 break_end), ' +
    'why a punch cannot be edited via the API (修正申請), and the statutory break (法定休憩: over 6h needs 45 min, over 8h needs 60 min). ' +
    'Same text as the kintai://guide resource. For today, call get_today_status. For the day or month checklist, call close_out. No arguments.',
  inputSchema: z.object({}),
  capability: 'profile',
  audience: 'everyone',
  kind: 'read',
  /** 外部の勤怠Plus には聞かない */
  openWorld: false,
  handler: async () => attendanceGuide(),
});
