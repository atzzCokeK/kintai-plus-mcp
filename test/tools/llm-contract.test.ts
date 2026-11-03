import { describe, expect, it } from 'vitest';
import { checkPunch } from '../../src/domain/punch-check.ts';
import { SERVER_INSTRUCTIONS } from '../../src/server/create-server.ts';
import { ALL_TOOLS } from '../../src/tools/index.ts';
import { annotationsFor } from '../../src/tools/registry.ts';

describe('LLM がツールを選ぶための契約', () => {
  it('全ツールが title と 4 つの hint を持つ。打刻は destructive ではなく、削除は destructive', () => {
    for (const tool of ALL_TOOLS) {
      expect(annotationsFor(tool), tool.name).toEqual({
        title: tool.title,
        readOnlyHint: tool.kind === 'read',
        destructiveHint: tool.destructive === true,
        idempotentHint: tool.idempotent ?? tool.kind === 'read',
        openWorldHint: tool.openWorld !== false,
      });
      expect(tool.title.length, tool.name).toBeGreaterThan(0);
      expect(tool.description.length, tool.name).toBeGreaterThan(80);
    }
    const punch = ALL_TOOLS.find((tool) => tool.name === 'punch');
    const save = ALL_TOOLS.find((tool) => tool.name === 'save_manhours');
    const remove = ALL_TOOLS.find((tool) => tool.name === 'delete_manhours');
    const guide = ALL_TOOLS.find((tool) => tool.name === 'get_attendance_guide');
    expect(punch).toMatchObject({ kind: 'write', destructive: false, idempotent: false });
    expect(punch?.description).toMatch(/CANNOT/);
    expect(save).toMatchObject({ destructive: false, idempotent: true });
    expect(save?.description).toMatch(/overwrit/i);
    expect(remove).toMatchObject({ destructive: true, idempotent: true });
    expect(remove?.description).toMatch(/ALL tasks/);
    expect(guide).toMatchObject({ kind: 'read', openWorld: false });
    expect(annotationsFor(guide as never).openWorldHint).toBe(false);
  });

  it('締めは close_out を先に呼ぶと案内する', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/close_out/);
    expect(SERVER_INSTRUCTIONS).toMatch(/YYYY-MM-DD/);
    expect(SERVER_INSTRUCTIONS).toMatch(/READ_ONLY/);
    const closeOut = ALL_TOOLS.find((tool) => tool.name === 'close_out');
    expect(closeOut?.kind).toBe('read');
    expect(closeOut?.description).toMatch(/INSTEAD OF chaining/);
    expect(closeOut?.description).toMatch(/45/);
    expect(closeOut?.description).toMatch(/60/);
  });

  it('矛盾した打刻は、次に呼べる種別か修正申請を理由に書く', () => {
    const onBreak = checkPunch('on_break', 'clock_out');
    expect(onBreak.ok).toBe(false);
    if (!onBreak.ok) expect(onBreak.reason).toMatch(/break_end/);
    const done = checkPunch('finished', 'clock_in');
    expect(done.ok).toBe(false);
    if (!done.ok) expect(done.reason).toMatch(/修正申請/);
    const idle = checkPunch('not_started', 'clock_out');
    expect(idle.ok).toBe(false);
    if (!idle.ok) expect(idle.reason).toMatch(/clock_in/);
  });
});
