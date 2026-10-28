import { McpServer } from '@modelcontextprotocol/server';
import { KintaiApiError } from '../api/errors.ts';
import { annotationsFor, type ToolContext, type ToolDefinition } from '../tools/registry.ts';
import { errorResult, successResult } from '../tools/result.ts';
import { PACKAGE_NAME, VERSION } from '../version.ts';

export const SERVER_INSTRUCTIONS = [
  'Unofficial MCP server for マネーフォワード クラウド勤怠Plus (formerly AKASHI).',
  'All dates and times are Japan time (Asia/Tokyo). Dates are YYYY-MM-DD.',
  'Punches (打刻) are recorded at the time the server receives them and cannot be edited or backdated via the API; corrections require a request (申請) in the web UI.',
  'Requests (申請) and schedules (スケジュール) are not supported.',
].join('\n');

export interface ServerHooks {
  /** API が認証エラーを返したとき（別プロセスがトークンを更新した可能性があるので読み直す） */
  onAuthError?: () => void;
}

export function createMcpServer(
  ctx: ToolContext,
  tools: readonly ToolDefinition[],
  hooks: ServerHooks = {},
): McpServer {
  const server = new McpServer(
    { name: PACKAGE_NAME, version: VERSION },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: annotationsFor(tool),
      },
      async (input: unknown) => {
        const started = Date.now();
        try {
          const data = await tool.handler(input as never, ctx);
          ctx.logger.debug(`tool ${tool.name} ok (${Date.now() - started}ms)`);
          return successResult(data);
        } catch (error) {
          if (error instanceof KintaiApiError && error.kind === 'auth') hooks.onAuthError?.();
          const name = error instanceof Error ? error.name : 'error';
          ctx.logger.warn(`tool ${tool.name} failed: ${name}`);
          return errorResult(error);
        }
      },
    );
  }
  return server;
}
