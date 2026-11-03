import type { McpServer } from '@modelcontextprotocol/server';
import { attendanceGuide } from '../domain/guide.ts';
import { closeOutTool } from '../tools/close-out.ts';
import type { ToolContext, ToolDefinition } from '../tools/registry.ts';
import { errorResult } from '../tools/result.ts';
import { getTodayStatusTool } from '../tools/stamps.ts';

const JSON_MIME = 'application/json';

interface ResourceSpec {
  name: string;
  uri: string;
  title: string;
  description: string;
  read: (uri: URL, ctx: ToolContext) => Promise<{ contents: ResourceContent[] }>;
}

interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

/** 公開中のツールと同じ情報だけをリソースにする。ツールが無いクライアント向けの補助。 */
export function kintaiResources(tools: readonly Pick<ToolDefinition, 'name'>[]): ResourceSpec[] {
  const names = new Set(tools.map((tool) => tool.name));
  const specs: ResourceSpec[] = [];
  if (names.has('get_today_status')) {
    specs.push({
      name: 'today',
      uri: 'kintai://today',
      title: "Today's work status",
      description:
        'Same as get_today_status: not_started / working / on_break / finished for today in Japan (Asia/Tokyo).',
      read: (uri, ctx) => readTool(uri, getTodayStatusTool, {}, ctx),
    });
  }
  if (names.has('close_out')) {
    specs.push({
      name: 'close-out-month',
      uri: 'kintai://close-out/month',
      title: "This month's close-out",
      description:
        'Same as close_out with scope month: remaining items for the current month in Japan (Asia/Tokyo).',
      read: (uri, ctx) => readTool(uri, closeOutTool, { scope: 'month' }, ctx),
    });
  }
  if (names.has('get_attendance_guide')) {
    specs.push({
      name: 'guide',
      uri: 'kintai://guide',
      title: 'Attendance rules and punch types',
      description:
        'Same as get_attendance_guide: punch types (打刻種別), statutory breaks (法定休憩), and how punch corrections work. Static, not your data.',
      read: async (uri) => jsonContents(uri, attendanceGuide()),
    });
  }
  return specs;
}

export function registerKintaiResources(
  server: McpServer,
  ctx: ToolContext,
  tools: readonly Pick<ToolDefinition, 'name'>[],
): void {
  for (const spec of kintaiResources(tools)) {
    server.registerResource(
      spec.name,
      spec.uri,
      { title: spec.title, description: spec.description, mimeType: JSON_MIME },
      (uri) => spec.read(uri, ctx),
    );
  }
}

async function readTool(
  uri: URL,
  tool: ToolDefinition,
  input: unknown,
  ctx: ToolContext,
): Promise<{ contents: ResourceContent[] }> {
  try {
    const data = await tool.handler(input as never, { ...ctx, confirm: async () => {} });
    return jsonContents(uri, data);
  } catch (error) {
    const result = errorResult(error);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/plain',
          text: result.content.map((part) => part.text).join(''),
        },
      ],
    };
  }
}

function jsonContents(uri: URL, data: unknown): { contents: ResourceContent[] } {
  return {
    contents: [{ uri: uri.href, mimeType: JSON_MIME, text: JSON.stringify(data) }],
  };
}
