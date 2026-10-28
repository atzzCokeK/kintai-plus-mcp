import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import type { Capability } from '../../src/backend/types.ts';
import { annotationsFor, defineTool, selectTools } from '../../src/tools/registry.ts';

const tool = (
  name: string,
  capability: Capability,
  audience: 'everyone' | 'admin',
  kind: 'read' | 'write',
) =>
  defineTool({
    name,
    title: name,
    description: name,
    inputSchema: z.object({}),
    capability,
    audience,
    kind,
    handler: async () => ({}),
  });

const tools = [
  tool('get_my_profile', 'profile', 'everyone', 'read'),
  tool('punch', 'stamps.write', 'everyone', 'write'),
  tool('list_staff', 'staff.read', 'admin', 'read'),
];
const all = new Set<Capability>(['profile', 'stamps.write', 'staff.read']);

const names = (ts: readonly { name: string }[]) => ts.map((t) => t.name);

describe('selectTools', () => {
  it('従業員には管理者向けツールを見せない', () => {
    expect(
      names(selectTools(tools, { capabilities: all, role: 'employee', readOnly: false })),
    ).toEqual(['get_my_profile', 'punch']);
  });

  it('一般管理者・企業管理者には管理者向けツールも見せる', () => {
    for (const role of ['admin', 'company_admin'] as const) {
      expect(names(selectTools(tools, { capabilities: all, role, readOnly: false }))).toEqual([
        'get_my_profile',
        'punch',
        'list_staff',
      ]);
    }
  });

  it('読み取り専用モードでは書き込みツールを出さない', () => {
    expect(names(selectTools(tools, { capabilities: all, role: 'admin', readOnly: true }))).toEqual(
      ['get_my_profile', 'list_staff'],
    );
  });

  it('バックエンドが対応していない機能のツールは出さない', () => {
    const caps = new Set<Capability>(['profile']);
    expect(
      names(selectTools(tools, { capabilities: caps, role: 'admin', readOnly: false })),
    ).toEqual(['get_my_profile']);
  });
});

describe('annotationsFor', () => {
  it('参照系は readOnlyHint', () => {
    expect(annotationsFor(tools[0] as never)).toEqual({
      title: 'get_my_profile',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    });
  });

  it('書き込み系は destructiveHint を申告する', () => {
    expect(annotationsFor(tools[1] as never)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it('ツールごとに idempotentHint を上書きできる', () => {
    const t = defineTool({ ...tools[1], name: 'save_manhours', idempotent: true } as never);
    expect(annotationsFor(t as never)).toMatchObject({ idempotentHint: true });
  });
});
