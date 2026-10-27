import type { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type { Role } from '../api/staff.ts';
import { ApiBackend } from '../backend/api-backend.ts';
import { NotLoggedInError } from '../credentials/token-manager.ts';
import type { Runtime } from '../runtime.ts';
import { ALL_TOOLS } from '../tools/index.ts';
import { selectTools, type ToolContext, type ToolDefinition } from '../tools/registry.ts';
import { createMcpServer } from './create-server.ts';

export interface ServerSetup {
  role: Role;
  tools: ToolDefinition[];
  createServer(): McpServer;
}

/**
 * 起動時に権限を確認し、公開するツールを決める（ADR 0004）。
 * 未ログインや通信失敗でも起動はし、その場合は従業員向けのツールだけを出す。
 */
export async function buildServerSetup(runtime: Runtime): Promise<ServerSetup> {
  const { logger, config } = runtime;
  const backend = new ApiBackend(() => runtime.getClient());

  let role: Role = 'employee';
  try {
    role = (await backend.getMyProfile()).role;
  } catch (error) {
    if (error instanceof NotLoggedInError) {
      logger.warn(
        'Not logged in. Run `npx kintai-plus-mcp login`. Tools will report this until then.',
      );
    } else {
      const name = error instanceof Error ? error.name : 'error';
      logger.warn(`Could not check permission (${name}); exposing employee tools only.`);
    }
  }

  const tools = selectTools(ALL_TOOLS, {
    capabilities: backend.capabilities,
    role,
    readOnly: config.readOnly,
  });
  logger.info(
    `Starting MCP server (role: ${role}, tools: ${tools.length}${config.readOnly ? ', read-only' : ''})`,
  );

  const ctx: ToolContext = {
    backend,
    config,
    logger,
    now: () => new Date(),
    confirm: async () => {}, // 呼び出しごとに createMcpServer が差し替える
  };
  return {
    role,
    tools,
    createServer: () =>
      createMcpServer(ctx, tools, { onAuthError: () => runtime.tokens.invalidate() }),
  };
}

/** stdio で MCP サーバーを起動する。旧プロトコル（2025 年版）のクライアントにも同じファクトリで応答する。 */
export async function startServer(runtime: Runtime): Promise<void> {
  const setup = await buildServerSetup(runtime);
  serveStdio(() => setup.createServer(), {
    onerror: (error) => runtime.logger.error(`MCP transport error: ${error.message}`),
  });
}
