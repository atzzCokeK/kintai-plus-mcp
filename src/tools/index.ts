import { getMyProfileTool } from './profile.ts';
import type { ToolDefinition } from './registry.ts';

/** すべてのツール。公開するかどうかは selectTools で決める */
export const ALL_TOOLS: readonly ToolDefinition[] = [getMyProfileTool];
