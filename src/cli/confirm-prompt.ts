import { type ConfirmLevel, DEFAULT_CONFIRM_LEVEL } from '../confirm.ts';
import type { ArrowChoice } from './arrow-select.ts';

export const CONFIRM_SELECT_MESSAGE = ['書き込み前の確認', '↑/↓ で移動、Enter で決定'].join('\n');

export function confirmSelectChoices(): readonly ArrowChoice<ConfirmLevel>[] {
  return [
    {
      value: 'always',
      label: '毎回確認する（すべての書き込み）',
      hint: '打刻・工数の保存・削除の前に確認する',
    },
    {
      value: 'destructive',
      label: '打刻は確認なし、削除だけ確認',
      hint: '既定。工数の保存も確認しない',
    },
    {
      value: 'never',
      label: '確認しない',
      hint: '確認ダイアログを出さない',
    },
  ];
}

export const DEFAULT_CONFIRM_CHOICE = DEFAULT_CONFIRM_LEVEL;
