import * as z from 'zod/v4';
import { addDays, todayInTokyo } from '../time/datetime.ts';

/**
 * 定型プロンプト（MCP Prompts）。クライアントのメニューから呼び出す、よくある頼み方のひな形。
 * 使うツールがすべて公開されているときだけ出す（権限・読み取り専用モードに合わせる）。
 */
export interface PromptDefinition<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  argsSchema: S;
  requiredTools: readonly string[];
  build(args: z.infer<S>, now: Date): string;
}

function definePrompt<S extends z.ZodObject>(p: PromptDefinition<S>): PromptDefinition<S> {
  return p;
}

const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe('YYYY-MM-DD');

export const ALL_PROMPTS: readonly PromptDefinition[] = [
  definePrompt({
    name: 'end_of_day',
    title: '退勤前チェック',
    description: '今日の勤務と工数を確認し、工数の入力漏れがあれば入力してから退勤を打刻する',
    argsSchema: z.object({}),
    requiredTools: ['get_today_status', 'get_manhours', 'save_manhours', 'punch'],
    build: (_args, now) => {
      const today = todayInTokyo(now);
      return [
        `今日（${today}）の退勤前チェックをしてください。`,
        '1. get_today_status で今日の勤務状況と勤務時間を確認する。休憩中なら先に休憩戻が必要か聞く。',
        `2. get_manhours（from=${today}, to=${today}）で今日の工数を確認し、勤務時間と比べて入力漏れがないか見る。`,
        '3. 足りなければ、何にどれくらい時間を使ったかを私に聞き、get_my_projects と list_tasks で ID を調べて save_manhours で入力する。',
        '4. 最後に、退勤（clock_out）を打刻してよいか私に確認してから punch する。打刻は取り消せないので、確認なしに打刻しないこと。',
      ].join('\n');
    },
  }),
  definePrompt({
    name: 'log_manhours',
    title: '工数を入力する',
    description: '指定した日（既定は今日）の工数を、話した内容から入力する',
    argsSchema: z.object({
      date: optionalDate.describe('工数を入力する日（YYYY-MM-DD、既定は今日）'),
      description: z
        .string()
        .optional()
        .describe('その日にやったこと（例: 設計 2 時間、定例 1 時間）'),
    }),
    requiredTools: ['get_my_projects', 'list_tasks', 'get_manhours', 'save_manhours'],
    build: (args, now) => {
      const date = args.date ?? todayInTokyo(now);
      return [
        `${date} の工数を入力してください。`,
        args.description
          ? `やったこと: ${args.description}`
          : 'やったことと時間を私に聞いてください。',
        '1. get_my_projects で参加プロジェクトを調べ、list_tasks で該当するタスクを探す。どれに当たるか迷ったら私に聞く。',
        `2. get_manhours（from=${date}, to=${date}）で既に入っている工数を確認する。`,
        '3. 入力内容（プロジェクト・タスク・時間）を一覧で見せて確認してから save_manhours で保存する。',
      ].join('\n');
    },
  }),
  definePrompt({
    name: 'monthly_review',
    title: '月の振り返り',
    description: '指定した月（既定は今月）の勤務時間・残業の目安・打刻漏れをまとめる',
    argsSchema: z.object({
      month: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional()
        .describe('月（YYYY-MM、既定は今月）'),
    }),
    requiredTools: ['summarize_working_hours', 'check_attendance_issues', 'get_alerts'],
    build: (args, now) => {
      const today = todayInTokyo(now);
      const month = args.month ?? today.slice(0, 7);
      const from = `${month}-01`;
      const isCurrent = month === today.slice(0, 7);
      const to = isCurrent ? today : undefined;
      const range = to ? `from=${from}, to=${to}` : `from=${from}（その月の末日まで）`;
      return [
        `${month} の勤務を振り返ってください。`,
        `1. summarize_working_hours（${range}）で実働合計・出勤日数・休日出勤・法定時間外の目安を出す。`,
        `2. check_attendance_issues（${isCurrent ? `from=${from}, to=${addDays(today, -1)}` : range}）で打刻漏れなどを確認する。`,
        `3. get_alerts（month=${month}）でアラートを確認する。`,
        '4. 結果を短くまとめ、直したほうがよい点（打刻修正の申請が必要な日など）を挙げる。残業は「目安」であることを必ず添える。',
      ].join('\n');
    },
  }),
  definePrompt({
    name: 'team_status',
    title: 'チームの今日の状況',
    description: '管理者向け: 管理下の従業員の今日の出勤状況と、残業が多くなりそうな人をまとめる',
    argsSchema: z.object({}),
    requiredTools: ['get_team_stamps', 'find_overtime_risks'],
    build: () =>
      [
        'チームの今日の状況をまとめてください。',
        '1. get_team_stamps で、今日の未出勤・勤務中・休憩中・退勤済みの人数と、未出勤の人を一覧にする（休暇の可能性があることを添える）。',
        '2. find_overtime_risks で、今月の残業が多い・多くなりそうな人を挙げる。数値は目安であることを添える。',
        '3. 個人情報は必要な範囲だけにとどめる。',
      ].join('\n'),
  }),
];

export function selectPrompts(
  prompts: readonly PromptDefinition[],
  toolNames: ReadonlySet<string>,
): PromptDefinition[] {
  return prompts.filter((p) => p.requiredTools.every((t) => toolNames.has(t)));
}
