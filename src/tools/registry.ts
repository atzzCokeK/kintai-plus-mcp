import type * as z from 'zod/v4';
import type { Role } from '../api/staff.ts';
import type { Capability, KintaiBackend } from '../backend/types.ts';
import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';

export interface ToolContext {
  backend: KintaiBackend;
  config: Config;
  logger: Logger;
  now: () => Date;
  /**
   * 書き込みの直前に呼ぶ。CONFIRM_WRITES=true のときはユーザーに確認し（Elicitation）、
   * 拒否されたら例外で中止する。無効のときは何もしない。
   */
  confirm(message: string): Promise<void>;
}

export interface ToolDefinition<S extends z.ZodObject = z.ZodObject> {
  /** 英語の snake_case */
  name: string;
  title: string;
  /** 英語。勤怠用語は日本語を併記する */
  description: string;
  inputSchema: S;
  /** このツールに必要なバックエンドの機能 */
  capability: Capability;
  audience: 'everyone' | 'admin';
  kind: 'read' | 'write';
  /** 同じ入力で繰り返しても結果が変わらない書き込み（工数の保存など） */
  idempotent?: boolean;
  /** 返り値は JSON にできる値 */
  handler(input: z.infer<S>, ctx: ToolContext): Promise<unknown>;
}

/** 型推論のためのヘルパー。未知の引数は捨てずに拒否する */
export function defineTool<S extends z.ZodObject>(tool: ToolDefinition<S>): ToolDefinition<S> {
  return { ...tool, inputSchema: tool.inputSchema.strict() as S };
}

export interface SelectOptions {
  capabilities: ReadonlySet<Capability>;
  role: Role;
  readOnly: boolean;
}

/** 権限・バックエンドの機能・読み取り専用モードに応じて、公開するツールを選ぶ（ADR 0004, 0005） */
export function selectTools<T extends Pick<ToolDefinition, 'capability' | 'audience' | 'kind'>>(
  tools: readonly T[],
  options: SelectOptions,
): T[] {
  return tools.filter(
    (tool) =>
      options.capabilities.has(tool.capability) &&
      (tool.audience === 'everyone' || options.role !== 'employee') &&
      (tool.kind === 'read' || !options.readOnly),
  );
}

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
}

export function annotationsFor(tool: ToolDefinition): ToolAnnotations {
  const write = tool.kind === 'write';
  return {
    title: tool.title,
    readOnlyHint: !write,
    destructiveHint: write,
    ...(tool.idempotent === undefined ? {} : { idempotentHint: tool.idempotent }),
    openWorldHint: true,
  };
}
