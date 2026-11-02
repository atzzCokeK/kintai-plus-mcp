import * as z from 'zod/v4';
import { todayInTokyo } from '../time/datetime.ts';

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
    description: '今日の締めを close_out で確認し、残件（休憩・工数・打刻）を処理してから退勤する',
    argsSchema: z.object({}),
    requiredTools: ['close_out', 'get_my_projects', 'list_tasks', 'save_manhours', 'punch'],
    build: (_args, now) => {
      const today = todayInTokyo(now);
      return [
        `今日（${today}、日本時間）の退勤前の締めをしてください。`,
        '1. close_out（scope=day）を 1 回だけ呼ぶ。get_today_status や get_manhours を先に連ねなくてよい。',
        '2. ok が true で items が空なら「対応は不要です」と伝えて終わる。headline をそのまま使ってよい。',
        '3. items を priority 順に処理する。action に修正申請とある項目は Web 画面の案内だけして、punch しない。',
        '4. 工数を入れるときは、何にどれくらい使ったかを私に聞き、get_my_projects と list_tasks で ID を調べ、一覧を見せてから save_manhours する。',
        '5. 退勤（clock_out）や休憩戻（break_end）は、私に確認してから punch する。打刻は取り消せない。',
        '6. overtime の数値は disclaimer のとおり目安である。',
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
    description: '指定した月（既定は今月）を close_out で確認し、残件と残業の目安をまとめる',
    argsSchema: z.object({
      month: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional()
        .describe('月（YYYY-MM、日本時間。既定は今月）'),
    }),
    requiredTools: ['close_out'],
    build: (args, now) => {
      const today = todayInTokyo(now);
      const month = args.month ?? today.slice(0, 7);
      return [
        `${month} の締めを確認してください。日付は日本時間です。`,
        `1. close_out（scope=month, month=${month}）を 1 回だけ呼ぶ。summarize_working_hours、check_attendance_issues、get_alerts を別に連ねなくてよい。`,
        '2. headline と items を短く伝える。ok が true で items が空なら「対応は不要です」と明言する。',
        '3. 打刻の修正が必要な日は Web の修正申請。API の punch では過去を直せない。',
        '4. overtime は目安なので disclaimer を添える。',
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
