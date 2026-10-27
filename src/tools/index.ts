import {
  getProjectMembersTool,
  getTeamStampsTool,
  getWorkingStatusesTool,
  listStaffTool,
} from './admin.ts';
import { getAlertsTool } from './alerts.ts';
import { checkAttendanceIssuesTool } from './attendance-issues.ts';
import { deleteManhoursTool, saveManhoursTool } from './manhours-write.ts';
import { getMyProfileTool } from './profile.ts';
import { getManhoursTool, getMyProjectsTool, listProjectsTool, listTasksTool } from './projects.ts';
import { punchTool } from './punch.ts';
import type { ToolDefinition } from './registry.ts';
import { getStampsTool, getTodayStatusTool } from './stamps.ts';
import { summarizeWorkingHoursTool } from './summary.ts';
import { getWorkingRecordsTool } from './working-records.ts';

/** すべてのツール。公開するかどうかは selectTools で決める */
export const ALL_TOOLS: readonly ToolDefinition[] = [
  getMyProfileTool,
  getTodayStatusTool,
  punchTool,
  getStampsTool,
  getWorkingRecordsTool,
  summarizeWorkingHoursTool,
  getAlertsTool,
  checkAttendanceIssuesTool,
  listProjectsTool,
  listTasksTool,
  getMyProjectsTool,
  getManhoursTool,
  saveManhoursTool,
  deleteManhoursTool,
  // 管理者向け
  listStaffTool,
  getTeamStampsTool,
  getWorkingStatusesTool,
  getProjectMembersTool,
];
