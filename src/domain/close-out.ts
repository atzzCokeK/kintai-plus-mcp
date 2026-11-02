import type { Alert } from '../api/alerts.ts';
import type { ManhourDay } from '../api/manhours.ts';
import type { Stamp, StampType } from '../api/stamps.ts';
import type { WorkingRecord } from '../api/working-records.ts';
import {
  addDays,
  diffDays,
  endOfDay,
  endOfMonth,
  type LocalDate,
  toLocalDate,
} from '../time/datetime.ts';
import {
  type AttendanceIssue,
  findAttendanceIssues,
  type IssueType,
  MAX_OVERNIGHT_SHIFT_MINUTES,
} from './attendance-issues.ts';
import { computeDayStatus, DAY_STATE_LABEL, type DayState, type DayStatus } from './day-status.ts';
import { assessOvertimeRisk, type OvertimeRisk, type RiskLevel } from './overtime-risk.ts';
import { UNKNOWN_BREAK_NOTE } from './summary.ts';

/**
 * 労働基準法 34 条。6 時間・8 時間ちょうどは「超える」に含めない。
 * 休憩の長さは打刻から数える（勤務実績 API は休憩を返さない）。
 */
export function requiredBreakMinutes(workedMinutes: number): number {
  if (workedMinutes > 8 * 60) return 60;
  if (workedMinutes > 6 * 60) return 45;
  return 0;
}

export const BREAK_RULE =
  '労働基準法: 労働時間が 6 時間を超えたら休憩 45 分以上、8 時間を超えたら 60 分以上（ちょうど 6 時間・8 時間は含まない）。';

/** 工数と実働の差で「ずれ」とする幅（分） */
export const MANHOUR_TOLERANCE_MINUTES = 15;
/** 進行中の日は、これ未満の実働で工数 0 でも未入力にしない */
const MANHOUR_NAG_AFTER_MINUTES = 60;

const CORRECTION =
  'この打刻は API では修正できません。勤怠Plus の Web 画面から修正申請（打刻修正）をしてください。punch は呼ばないでください（今の時刻で新しい打刻が増えるだけです）。';

export const CLOSEOUT_DISCLAIMER =
  '法定時間外は目安です（労働日・所定休日は 1 日 8 時間を超えた分、法定休日は全時間）。' +
  '週 40 時間、変形労働時間制、フレックスタイム制、祝日・休暇の予定は考慮していません。' +
  '正式な値は勤怠Plus の画面や給与計算で確認してください。';

export type CloseoutCode =
  | IssueType
  | 'short_break'
  | 'open_break'
  | 'overnight_open'
  | 'still_working'
  | 'not_clocked_in'
  | 'manhours_missing'
  | 'manhours_mismatch'
  | 'overtime_over'
  | 'overtime_likely'
  | 'overtime_watch'
  | 'alert'
  | 'incomplete_data';

export interface CloseoutItem {
  priority: number;
  severity: 'error' | 'warning' | 'info';
  code: CloseoutCode;
  date?: LocalDate;
  title: string;
  detail: string;
  action: string;
  tool?: string;
  toolArgs?: Record<string, string>;
}

export interface CloseoutTodayStatus {
  date: LocalDate;
  state: DayState;
  stateLabel: string;
  workedMinutes: number;
  workedHours: string;
  breakMinutes: number;
}

export interface CloseoutOvertime {
  month: string;
  asOf: LocalDate;
  level: RiskLevel;
  thresholdHours: number;
  overtimeSoFarMinutes: number;
  overtimeSoFarHours: string;
  projectedOvertimeMinutes: number;
  projectedOvertimeHours: string;
  elapsedWorkDays: number;
  remainingWorkDays: number;
  breakTimeUnknown: boolean;
}

export interface CloseoutReport {
  scope: 'day' | 'month';
  timezone: 'Asia/Tokyo';
  today: LocalDate;
  date?: LocalDate;
  month: string;
  from: LocalDate;
  to: LocalDate;
  ok: boolean;
  readyToClose: boolean;
  headline: string;
  counts: { error: number; warning: number; info: number };
  items: CloseoutItem[];
  todayStatus?: CloseoutTodayStatus;
  overtime: CloseoutOvertime;
  alerts: { inScope: number; listed: number; alreadyCovered: number };
  disclaimer: string;
  note: string;
}

export interface CloseoutInput {
  scope: 'day' | 'month';
  /** 日本時間の今日 */
  today: LocalDate;
  now: Date;
  /** scope=day の対象日。scope=month では無視して today を使う */
  date: LocalDate;
  /** YYYY-MM */
  month: string;
  thresholdHours: number;
  records: readonly WorkingRecord[];
  stamps: readonly Stamp[];
  manhours: readonly ManhourDay[];
  alerts: readonly Alert[];
  /** 取れなかった API。警告項目にする */
  gaps?: readonly string[];
}

const BLOCKS_READY = new Set<CloseoutCode>([
  'still_working',
  'open_break',
  'not_clocked_in',
  'overnight_open',
  'short_break',
]);

const CODE_RANK: Partial<Record<CloseoutCode, number>> = {
  open_break: 0,
  overnight_open: 1,
  short_break: 2,
  missing_break_end: 3,
  missing_clock_out: 4,
  missing_clock_in: 5,
  no_punches_on_workday: 6,
  manhours_missing: 7,
  manhours_mismatch: 8,
  short_interval: 9,
  long_working_day: 10,
  overtime_over: 11,
  overtime_likely: 12,
  overtime_watch: 13,
  alert: 14,
  incomplete_data: 15,
  still_working: 16,
  not_clocked_in: 17,
  holiday_work: 18,
};

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

/** アラート種別 → すでに項目があれば重ねない */
const ALERT_COVERED_BY: Partial<Record<number, readonly CloseoutCode[]>> = {
  1: [
    'missing_clock_out',
    'missing_clock_in',
    'missing_break_end',
    'no_punches_on_workday',
    'open_break',
    'overnight_open',
  ],
  3: ['short_break'],
  28: ['short_break'],
  22: ['manhours_missing', 'manhours_mismatch'],
  9: ['overtime_over', 'overtime_likely', 'overtime_watch'],
  13: ['overtime_over', 'overtime_likely', 'overtime_watch'],
  14: ['short_interval'],
  6: ['holiday_work'],
};

const isIn = (s: Stamp) => s.type === 'clock_in' || s.type === 'direct_in';
const isOut = (s: Stamp) => s.type === 'clock_out' || s.type === 'direct_out';
const isBoundary = (s: Stamp) =>
  isIn(s) || isOut(s) || s.type === 'break_start' || s.type === 'break_end';

/**
 * 1 日または 1 か月の「まだやること」。
 * 打刻漏れは findAttendanceIssues、残業の着地は assessOvertimeRisk、実働と休憩は computeDayStatus を使う。
 * 今日は endOfDay ではなく now で見るので、進行中を退勤漏れにしない。
 */
export function buildCloseout(input: CloseoutInput): CloseoutReport {
  const { today, now, scope } = input;
  const monthStart = `${input.month}-01`;
  const monthEnd = endOfMonth(monthStart);
  // biome-ignore lint/complexity/useMathMinMax: YYYY-MM-DD の文字列比較なので Math.min は使えない
  const throughToday = monthEnd < today ? monthEnd : today;
  const from = scope === 'day' ? input.date : monthStart;
  const to = scope === 'day' ? input.date : throughToday;
  const yesterday = addDays(today, -1);
  const byDate = stampsByDate(input.stamps);
  const recordByDate = new Map(input.records.map((r) => [r.date, r]));
  const manhourByDate = new Map(input.manhours.map((d) => [d.date, d]));

  const items: CloseoutItem[] = [];
  // biome-ignore lint/complexity/useMathMinMax: YYYY-MM-DD の文字列比較なので Math.min は使えない
  const pastTo = to < yesterday ? to : yesterday;
  const pastIssues =
    from <= pastTo
      ? findAttendanceIssues({
          range: { from, to: pastTo },
          records: input.records,
          stamps: input.stamps,
        })
      : [];
  for (const issue of pastIssues) {
    if (issue.type === 'holiday_work') continue;
    items.push(itemFromIssue(issue));
  }

  const todayInRange = from <= today && today <= to;
  const overnight = todayInRange ? overnightItem(byDate, today, now) : undefined;
  if (overnight) {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (
        item &&
        item.date === overnight.date &&
        (item.code === 'missing_clock_out' || item.code === 'missing_break_end')
      ) {
        items.splice(i, 1);
      }
    }
    items.push(overnight);
  }

  if (from <= pastTo) {
    for (let i = 0; i <= diffDays(from, pastTo); i++) {
      const date = addDays(from, i);
      if (overnight?.date === date) continue;
      const status = computeDayStatus(byDate.get(date) ?? [], endOfDay(date));
      const open = pastIssues.some(
        (issue) =>
          issue.date === date &&
          (issue.type === 'missing_clock_out' || issue.type === 'missing_break_end'),
      );
      if (!open && status.state === 'finished') {
        pushShortBreak(items, date, status, 'past');
        pushManhours(items, date, status.workedMinutes, manhourByDate.get(date), false);
      }
    }
  }

  let todayStatus: CloseoutTodayStatus | undefined;
  if (todayInRange) {
    const status = computeDayStatus(byDate.get(today) ?? [], now);
    todayStatus = {
      date: today,
      state: status.state,
      stateLabel: DAY_STATE_LABEL[status.state],
      workedMinutes: status.workedMinutes,
      workedHours: formatHm(status.workedMinutes),
      breakMinutes: status.breakMinutes,
    };
    pushLive(items, today, status, recordByDate.get(today), manhourByDate.get(today), overnight);
  }

  const overtime = overtimeOf(input, monthStart, monthEnd);
  pushOvertime(items, overtime);

  const alerts = pushAlerts(items, input.alerts, input.month, from, to);
  if (input.gaps && input.gaps.length > 0) {
    items.push({
      priority: 0,
      severity: 'warning',
      code: 'incomplete_data',
      title: '一部のデータを取れませんでした',
      detail: input.gaps.join(' '),
      action:
        '時間をおいて close_out を再実行してください。権限エラーなら、従業員設定の「公開API利用可否」を確認してください。取れた項目だけ先に対応できます。',
    });
  }

  items.sort(compareItems);
  items.forEach((item, index) => {
    item.priority = index + 1;
  });

  const counts = { error: 0, warning: 0, info: 0 };
  for (const item of items) counts[item.severity]++;
  const todo = counts.error + counts.warning;
  const ok = todo === 0;
  const readyToClose = ok && items.every((item) => !BLOCKS_READY.has(item.code));
  const label = scope === 'day' ? input.date : input.month;
  const headline = headlineFor(label, todo, readyToClose, items.length);
  const breakTimeUnknown = input.records.some((r) => r.workingMinutesAreGross === true);

  const report: CloseoutReport = {
    scope,
    timezone: 'Asia/Tokyo',
    today,
    ...(scope === 'day' ? { date: input.date } : {}),
    month: input.month,
    from,
    to,
    ok,
    readyToClose,
    headline,
    counts,
    items,
    ...(todayStatus ? { todayStatus } : {}),
    overtime,
    alerts,
    disclaimer: breakTimeUnknown
      ? `${CLOSEOUT_DISCLAIMER} ${UNKNOWN_BREAK_NOTE}`
      : CLOSEOUT_DISCLAIMER,
    note: '打刻の修正は API ではできません。過去の打刻は勤怠Plus の Web 画面から修正申請してください。',
  };
  return report;
}

function stampsByDate(stamps: readonly Stamp[]): Map<LocalDate, Stamp[]> {
  const map = new Map<LocalDate, Stamp[]>();
  for (const stamp of stamps) {
    const date = toLocalDate(stamp.stampedAt);
    const list = map.get(date);
    if (list) list.push(stamp);
    else map.set(date, [stamp]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.stampedAt.getTime() - b.stampedAt.getTime());
  }
  return map;
}

function itemFromIssue(issue: AttendanceIssue): CloseoutItem {
  const action = actionForIssue(issue.type);
  return {
    priority: 0,
    severity: issue.severity,
    code: issue.type,
    date: issue.date,
    title: issue.message,
    detail: issue.message,
    action,
  };
}

function actionForIssue(type: IssueType): string {
  switch (type) {
    case 'missing_clock_out':
    case 'missing_break_end':
    case 'missing_clock_in':
      return CORRECTION;
    case 'no_punches_on_workday':
      return '休暇・欠勤なら対応不要です。出勤したのに打刻が無い場合は、勤怠Plus の Web 画面から修正申請してください。API の punch では過去の打刻を作れません。';
    case 'short_interval':
      return '勤務間インターバルが短い日です。打刻を直すなら Web の修正申請です。punch は呼ばないでください。';
    case 'long_working_day':
      return '長時間になっていないか、休憩の打刻漏れがないか確認してください。打刻の修正は Web の修正申請です。';
    default:
      return '内容を確認してください。申請が必要なら勤怠Plus の Web 画面から行ってください。';
  }
}

function overnightItem(
  byDate: Map<LocalDate, Stamp[]>,
  today: LocalDate,
  now: Date,
): CloseoutItem | undefined {
  const yDate = addDays(today, -1);
  const yStamps = byDate.get(yDate) ?? [];
  const todayStamps = byDate.get(today) ?? [];
  if (todayStamps.some(isBoundary)) return undefined;
  const yStatus = computeDayStatus(yStamps, endOfDay(yDate));
  if (yStatus.state !== 'working' && yStatus.state !== 'on_break') return undefined;
  const lastIn = [...yStamps].reverse().find(isIn);
  if (!lastIn) return undefined;
  const elapsedMin = Math.round((now.getTime() - lastIn.stampedAt.getTime()) / 60_000);
  if (elapsedMin < 0 || elapsedMin > MAX_OVERNIGHT_SHIFT_MINUTES) return undefined;
  const type: StampType = yStatus.state === 'on_break' ? 'break_end' : 'clock_out';
  const title =
    yStatus.state === 'on_break'
      ? '昨日からの休憩が終わっていません'
      : '昨日からの勤務が退勤されていません';
  const action =
    type === 'break_end'
      ? '先に punch（type=break_end、休憩戻）してください。その後、退勤するときに punch（type=clock_out）。打刻は取り消せないので、実行前に本人へ確認してください。'
      : '今 punch（type=clock_out）すれば、昨日の出勤とつながる退勤になります。実行前に本人へ確認してください。API では過去時刻を指定できません。';
  return {
    priority: 0,
    severity: 'error',
    code: 'overnight_open',
    date: yDate,
    title,
    detail: `出勤から ${formatHm(elapsedMin)} 経っています。${MAX_OVERNIGHT_SHIFT_MINUTES / 60} 時間以内なので、今の打刻で日をまたぐ勤務として閉じられます。`,
    action,
    tool: 'punch',
    toolArgs: { type },
  };
}

function pushLive(
  items: CloseoutItem[],
  today: LocalDate,
  status: DayStatus,
  record: WorkingRecord | undefined,
  manhours: ManhourDay | undefined,
  overnight: CloseoutItem | undefined,
): void {
  if (status.state === 'on_break') {
    const need = requiredBreakMinutes(status.workedMinutes);
    if (status.breakMinutes < need) pushShortBreak(items, today, status, 'stay');
    else items.push(openBreakItem(today));
    pushManhours(items, today, status.workedMinutes, manhours, true);
    return;
  }
  if (status.state === 'working') {
    pushShortBreak(items, today, status, 'before_leave');
    items.push({
      priority: 0,
      severity: 'info',
      code: 'still_working',
      date: today,
      title: 'まだ勤務中です',
      detail: `ここまでの実働は ${formatHm(status.workedMinutes)}、休憩は ${status.breakMinutes} 分です。`,
      action:
        '退勤するときに punch（type=clock_out）してください。打刻はサーバー到着時刻で記録され、API から取り消せません。実行前に本人へ確認してください。',
      tool: 'punch',
      toolArgs: { type: 'clock_out' },
    });
    pushManhours(items, today, status.workedMinutes, manhours, true);
    return;
  }
  if (status.state === 'finished') {
    pushShortBreak(items, today, status, 'past');
    pushManhours(items, today, status.workedMinutes, manhours, false);
    return;
  }
  if (overnight) return;
  const holiday =
    record?.dayCategory === 'scheduled_holiday' || record?.dayCategory === 'legal_holiday';
  if (holiday) return;
  items.push({
    priority: 0,
    severity: 'info',
    code: 'not_clocked_in',
    date: today,
    title: '未出勤です',
    detail: '今日の打刻がまだありません。',
    action:
      '出勤するなら punch（type=clock_in、直行なら direct_in）してください。休暇なら対応不要です。打刻は取り消せないので、実行前に本人へ確認してください。',
    tool: 'punch',
    toolArgs: { type: 'clock_in' },
  });
}

function openBreakItem(date: LocalDate): CloseoutItem {
  return {
    priority: 0,
    severity: 'error',
    code: 'open_break',
    date,
    title: '休憩中のままです',
    detail: '休憩戻が無いと退勤（clock_out）は拒否されます。',
    action:
      '先に punch（type=break_end、休憩戻）してください。実行前に本人へ確認してください。今日の休憩戻は punch で足します。',
    tool: 'punch',
    toolArgs: { type: 'break_end' },
  };
}

function pushShortBreak(
  items: CloseoutItem[],
  date: LocalDate,
  status: DayStatus,
  mode: 'past' | 'stay' | 'before_leave',
): void {
  const need = requiredBreakMinutes(status.workedMinutes);
  if (need === 0 || status.breakMinutes >= need) return;
  const shortBy = need - status.breakMinutes;
  const title =
    status.breakMinutes === 0
      ? '休憩が打刻されていません'
      : `休憩が ${status.breakMinutes} 分しかありません`;
  const detail =
    `打刻上の休憩は ${status.breakMinutes} 分、実働は ${formatHm(status.workedMinutes)}。` +
    `${BREAK_RULE}必要 ${need} 分、あと ${shortBy} 分足りません。`;
  const action =
    mode === 'stay'
      ? `必要休憩は ${need} 分（いま ${status.breakMinutes} 分）です。あと約 ${shortBy} 分続けてから punch（type=break_end、休憩戻）してください。今すぐ戻すと休憩不足のままになります。`
      : mode === 'before_leave'
        ? `退勤する前に punch（type=break_start、休憩入）し、必要休憩 ${need} 分になるまで（あと ${shortBy} 分）休んでから punch（type=break_end）してください。足りないまま clock_out すると、後から API では直せません。`
        : `この日はすでに終わっているので、今 punch しても休憩は増えません。${CORRECTION}`;
  const item: CloseoutItem = {
    priority: 0,
    severity: mode === 'past' ? 'error' : 'warning',
    code: 'short_break',
    date,
    title,
    detail,
    action,
  };
  if (mode === 'stay') {
    item.tool = 'punch';
    item.toolArgs = { type: 'break_end' };
  } else if (mode === 'before_leave') {
    item.tool = 'punch';
    item.toolArgs = { type: 'break_start' };
  }
  items.push(item);
}

function pushManhours(
  items: CloseoutItem[],
  date: LocalDate,
  net: number,
  day: ManhourDay | undefined,
  live: boolean,
): void {
  if (net <= 0) return;
  const total = day?.totalMinutes ?? 0;
  if (live && total === 0 && net < MANHOUR_NAG_AFTER_MINUTES) return;
  if (Math.abs(total - net) <= MANHOUR_TOLERANCE_MINUTES) return;
  const locked = day?.closed === true || day?.fixed === true;
  const missing = total === 0;
  const diff = Math.abs(total - net);
  const item: CloseoutItem = {
    priority: 0,
    severity: 'warning',
    code: missing ? 'manhours_missing' : 'manhours_mismatch',
    date,
    title: missing ? '工数が未入力です' : '工数が勤務時間とずれています',
    detail: `実働 ${formatHm(net)} に対し、工数は ${formatHm(total)} です（許容は ${MANHOUR_TOLERANCE_MINUTES} 分、差は ${diff} 分）。`,
    action: locked
      ? `${date} の工数は${day?.fixed ? '確定済み' : '締め済み'}で、save_manhours も delete_manhours も使えません。勤怠Plus の Web 画面で開き直してもらってください。`
      : missing
        ? `get_my_projects と list_tasks で ID を調べ、内訳を本人に確認してから save_manhours（date=${date}）を呼んでください。entries が揃うまで save_manhours は呼ばないでください。`
        : `get_manhours（from=${date}, to=${date}）で内訳を見て、save_manhours か delete_manhours で実働に揃えてください。実行前に本人へ確認してください。`,
  };
  if (!locked && missing) {
    item.tool = 'get_my_projects';
  } else if (!locked) {
    item.tool = 'get_manhours';
    item.toolArgs = { from: date, to: date };
  }
  items.push(item);
}

function overtimeOf(
  input: CloseoutInput,
  monthStart: LocalDate,
  monthEnd: LocalDate,
): CloseoutOvertime {
  const yesterday = addDays(input.today, -1);
  const asOfCandidate = yesterday < monthEnd ? yesterday : monthEnd;
  const asOf = asOfCandidate >= monthStart ? asOfCandidate : addDays(monthStart, -1);
  const risk: OvertimeRisk = assessOvertimeRisk({
    records: input.records.filter((r) => r.date >= monthStart && r.date <= monthEnd),
    asOf,
    monthEnd,
    thresholdMinutes: input.thresholdHours * 60,
  });
  return {
    month: input.month,
    asOf,
    level: risk.level,
    thresholdHours: input.thresholdHours,
    overtimeSoFarMinutes: risk.overtimeSoFarMinutes,
    overtimeSoFarHours: formatHm(risk.overtimeSoFarMinutes),
    projectedOvertimeMinutes: risk.projectedOvertimeMinutes,
    projectedOvertimeHours: formatHm(risk.projectedOvertimeMinutes),
    elapsedWorkDays: risk.elapsedWorkDays,
    remainingWorkDays: risk.remainingWorkDays,
    breakTimeUnknown: input.records.some((r) => r.workingMinutesAreGross === true),
  };
}

function pushOvertime(items: CloseoutItem[], overtime: CloseoutOvertime): void {
  if (overtime.level === 'ok') return;
  const label =
    overtime.level === 'over'
      ? '法定時間外の目安が、すでにしきい値を超えています'
      : overtime.level === 'likely'
        ? 'このペースだと、月末の法定時間外の目安がしきい値を超えそうです'
        : '月末の法定時間外の目安が、しきい値の 8 割に届きそうです';
  items.push({
    priority: 0,
    severity: overtime.level === 'watch' ? 'info' : 'warning',
    code: `overtime_${overtime.level}`,
    title: label,
    detail:
      `${overtime.month} の目安はここまで ${overtime.overtimeSoFarHours}、` +
      `月末の着地予測は ${overtime.projectedOvertimeHours}` +
      `（しきい値 ${overtime.thresholdHours} 時間、残り平日 ${overtime.remainingWorkDays} 日）。`,
    action:
      '数値は目安です。正式な値は勤怠Plus で確認してください。申請が必要なら Web 画面から行ってください（API は申請に対応していません）。',
  });
}

function pushAlerts(
  items: CloseoutItem[],
  alerts: readonly Alert[],
  month: string,
  from: LocalDate,
  to: LocalDate,
): CloseoutReport['alerts'] {
  const inScope = alerts.filter((alert) => alertInScope(alert, month, from, to));
  let alreadyCovered = 0;
  let listed = 0;
  for (const alert of inScope) {
    const covered = ALERT_COVERED_BY[alert.type];
    const hit =
      covered?.some((code) =>
        items.some(
          (item) =>
            item.code === code &&
            (alert.date === undefined || item.date === undefined || item.date === alert.date),
        ),
      ) === true;
    if (hit) {
      alreadyCovered++;
      continue;
    }
    listed++;
    items.push({
      priority: 0,
      severity: alert.type === 9 || alert.type === 13 ? 'warning' : 'info',
      code: 'alert',
      ...(alert.date ? { date: alert.date } : {}),
      title: alert.label,
      detail: `勤怠Plus のアラート（種別 ${alert.type}）${alert.date ? ` ${alert.date}` : ''}。`,
      action: actionForAlert(alert.type),
    });
  }
  return { inScope: inScope.length, listed, alreadyCovered };
}

function alertInScope(alert: Alert, month: string, from: LocalDate, to: LocalDate): boolean {
  if (alert.date) return alert.date >= from && alert.date <= to;
  return alert.month === month;
}

function actionForAlert(type: number): string {
  switch (type) {
    case 7:
    case 8:
      return '遅刻・早退の打刻を直すなら、勤怠Plus の Web 画面から修正申請してください。punch では過去を直せません。';
    case 2:
      return '休暇・欠勤なら対応不要です。出勤しているなら Web 画面から修正申請してください。';
    case 1:
    case 3:
    case 28:
      return CORRECTION;
    case 22:
      return 'get_manhours でその日を確認し、未入力なら get_my_projects と list_tasks のあと save_manhours です。締め・確定済みなら Web 画面で開き直してもらってください。';
    default:
      return '勤怠Plus の画面でこのアラートを確認してください。申請が必要なら Web 画面から（API は申請に対応していません）。';
  }
}

function compareItems(a: CloseoutItem, b: CloseoutItem): number {
  const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (severity !== 0) return severity;
  if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.date && !b.date) return -1;
  if (!a.date && b.date) return 1;
  return (CODE_RANK[a.code] ?? 50) - (CODE_RANK[b.code] ?? 50);
}

function headlineFor(label: string, todo: number, ready: boolean, itemCount: number): string {
  if (todo > 0) return `先に ${todo} 件対応してください。items を priority 順に処理してください。`;
  if (ready && itemCount === 0) return `${label} は締められます。対応は不要です。`;
  if (ready) return '対応は不要です。参考情報が items にあります。';
  return '急ぎの対応はありません。items の案内に従って、休憩を戻すか退勤してください。';
}

function formatHm(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}
