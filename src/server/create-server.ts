import {
  inputRequired,
  inputResponse,
  McpServer,
  type ServerContext,
} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { KintaiApiError } from '../api/errors.ts';
import { type PromptDefinition, selectPrompts } from '../prompts/index.ts';
import { annotationsFor, type ToolContext, type ToolDefinition } from '../tools/registry.ts';
import { errorResult, successResult, ToolRefusedError } from '../tools/result.ts';
import { PACKAGE_NAME, VERSION } from '../version.ts';

export const SERVER_INSTRUCTIONS = [
  'Unofficial MCP server for マネーフォワード クラウド勤怠Plus (formerly AKASHI).',
  'All dates and times are Japan time (Asia/Tokyo, no daylight saving). Date arguments are YYYY-MM-DD. Month arguments are YYYY-MM with the month in 01-12.',
  'For "what should I do before clocking out" or month-end (1日の締め / 月末の締め), call close_out once. Do not chain get_today_status, check_attendance_issues, get_manhours, summarize_working_hours, and get_alerts for that checklist.',
  'punch is recorded at the time the server receives it and cannot be edited, deleted, or backdated. Past corrections need 修正申請 in the web UI, not punch.',
  'save_manhours overwrites only the tasks you list. delete_manhours removes them; omitting taskId deletes every task of that project for the day. Confirm with the user before any write.',
  'If punch, save_manhours, or delete_manhours is not listed, the server is read-only (KINTAI_PLUS_READ_ONLY=true). Tell the user; do not retry the write.',
  'Requests (申請) and schedules (スケジュール) are not supported. Overtime figures are estimates.',
].join('\n');

export interface ServerHooks {
  /** API が認証エラーを返したとき（別プロセスがトークンを更新した可能性があるので読み直す） */
  onAuthError?: () => void;
}

const CONFIRM_KEY = 'confirm';
const ConfirmSchema = z.object({
  confirm: z.boolean().describe('Proceed with this change?'),
});

/** ctx.confirm が「ユーザーへの確認が必要」と知らせるための内部シグナル */
class ConfirmationRequired extends Error {}

export function createMcpServer(
  ctx: ToolContext,
  tools: readonly ToolDefinition[],
  hooks: ServerHooks = {},
  prompts: readonly PromptDefinition[] = [],
): McpServer {
  const visiblePrompts = selectPrompts(prompts, new Set(tools.map((t) => t.name)));
  const server = new McpServer(
    { name: PACKAGE_NAME, version: VERSION },
    {
      capabilities: { tools: {}, ...(visiblePrompts.length > 0 ? { prompts: {} } : {}) },
      instructions: SERVER_INSTRUCTIONS,
    },
  );
  for (const prompt of visiblePrompts) {
    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description, argsSchema: prompt.argsSchema },
      (args: unknown) => ({
        messages: [
          {
            role: 'user' as const,
            content: { type: 'text' as const, text: prompt.build(args as never, ctx.now()) },
          },
        ],
      }),
    );
  }
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        annotations: annotationsFor(tool),
      },
      async (input: unknown, serverCtx: ServerContext) => {
        const started = Date.now();
        const callCtx: ToolContext = {
          ...ctx,
          confirm: (message) => confirmWrite(tool, ctx, serverCtx, message),
        };
        try {
          const data = await tool.handler(input as never, callCtx);
          ctx.logger.debug(`tool ${tool.name} ok (${Date.now() - started}ms)`);
          return successResult(data);
        } catch (error) {
          if (error instanceof ConfirmationRequired) {
            // クライアントに確認を求め、回答付きで再実行してもらう（旧プロトコルでは SDK が elicitation/create に変換する）
            return inputRequired({
              inputRequests: {
                [CONFIRM_KEY]: inputRequired.elicit({
                  message: error.message,
                  requestedSchema: ConfirmSchema,
                }),
              },
            });
          }
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

async function confirmWrite(
  tool: ToolDefinition,
  ctx: ToolContext,
  serverCtx: ServerContext,
  message: string,
): Promise<void> {
  if (!ctx.config.confirmWrites || tool.kind !== 'write') return;
  const response = inputResponse(serverCtx.mcpReq.inputResponses, CONFIRM_KEY);
  if (response.kind === 'missing') throw new ConfirmationRequired(message);
  const accepted =
    response.kind === 'elicit' &&
    response.action === 'accept' &&
    ConfirmSchema.safeParse(response.content).data?.confirm === true;
  if (!accepted) {
    throw new ToolRefusedError(
      'Cancelled by the user. Nothing was changed.',
      'Do not retry unless the user asks again.',
    );
  }
}
