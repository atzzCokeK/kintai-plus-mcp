import { describe, expect, it } from 'vitest';
import { checkPunch } from '../../src/domain/punch-check.ts';
import { SERVER_INSTRUCTIONS } from '../../src/server/create-server.ts';
import { ALL_TOOLS } from '../../src/tools/index.ts';
import { annotationsFor } from '../../src/tools/registry.ts';

describe('LLM がツールを選ぶための契約', () => {
  it('参照は readOnly、書き込みは destructive。punch は冪等ではない', () => {
    for (const tool of ALL_TOOLS) {
      const annotations = annotationsFor(tool);
      expect(annotations.readOnlyHint, tool.name).toBe(tool.kind === 'read');
      expect(annotations.destructiveHint, tool.name).toBe(tool.kind === 'write');
      expect(tool.description.length, tool.name).toBeGreaterThan(80);
    }
    const punch = ALL_TOOLS.find((tool) => tool.name === 'punch');
    const save = ALL_TOOLS.find((tool) => tool.name === 'save_manhours');
    const remove = ALL_TOOLS.find((tool) => tool.name === 'delete_manhours');
    expect(annotationsFor(punch as never).idempotentHint).toBe(false);
    expect(punch?.description).toMatch(/CANNOT/);
    expect(annotationsFor(save as never).idempotentHint).toBe(true);
    expect(save?.description).toMatch(/overwrit/i);
    expect(annotationsFor(remove as never).idempotentHint).toBe(true);
    expect(remove?.description).toMatch(/ALL tasks/);
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
