/** 書き込み前の確認レベル。login で保存し、KINTAI_PLUS_CONFIRM で上書きできる。 */
export const CONFIRM_LEVELS = ['always', 'destructive', 'never'] as const;

export type ConfirmLevel = (typeof CONFIRM_LEVELS)[number];

/** 打刻と工数の保存は確認せず、削除だけ確認する。 */
export const DEFAULT_CONFIRM_LEVEL: ConfirmLevel = 'destructive';

export const CONFIRM_LEVEL_LABEL: Record<ConfirmLevel, string> = {
  always: '毎回確認する（すべての書き込み）',
  destructive: '打刻は確認なし、削除だけ確認',
  never: '確認しない',
};

export function isConfirmLevel(value: unknown): value is ConfirmLevel {
  return typeof value === 'string' && (CONFIRM_LEVELS as readonly string[]).includes(value);
}

/**
 * この呼び出しで確認が必要か。
 * destructive はデータを消すツールだけ（工数の削除）。打刻と工数の保存は含めない。
 */
export function needsConfirm(
  tool: { kind: 'read' | 'write'; destructive?: boolean },
  level: ConfirmLevel,
): boolean {
  if (tool.kind !== 'write' || level === 'never') return false;
  if (level === 'always') return true;
  return tool.destructive === true;
}
