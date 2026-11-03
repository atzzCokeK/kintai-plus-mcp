import type { Stamp } from '../api/stamps.ts';
import type { WorkingRecord } from '../api/working-records.ts';
import { addDays, diffDays, endOfMonth, type LocalDate, toLocalDate } from '../time/datetime.ts';
import {
  type AttendanceIssue,
  findAttendanceIssues,
  type IssueSeverity,
  type IssueType,
  MAX_OVERNIGHT_SHIFT_MINUTES,
} from './attendance-issues.ts';
import { BREAK_RULE, CLOSEOUT_DISCLAIMER, requiredBreakMinutes } from './close-out.ts';
import { assessOvertimeRisk, type RiskLevel } from './overtime-risk.ts';
import { UNKNOWN_BREAK_NOTE } from './summary.ts';
import { readWorkingMinutes, recordedNetMinutes } from './worked-minutes.ts';

export const TEAM_UNSUPPORTED = [
  'アラート API（GET /alerts）は本人分だけで、従業員を指定できません。遅刻・早退・36協定の正式な判定・深夜労働・工数未入力のアラートは、チーム分を見ていません。打刻漏れ、休憩、勤務間インターバル、残業の目安は、この結果で代わりに計算しています。',
  '工数の未入力は見ていません。各メンバーの工数は、本人の close_out で確認してください。',
  '休暇・申請・スケジュールは公開 API にありません。労働日に打刻も実績時刻も無い日は、休暇の可能性があります。',
] as const;

export const TEAM_ESTIMATE_NOTE =
  '実働時間（まるめなし）と休憩実績を付けるパラメータの応答は未検証です。応答にそれらの項目が無い日は、打刻の休憩を使い、打刻でも休憩が分からないときは法定の最低休憩を引いた見積もりを残業の目安に使います。見積もりであることは注記します。管理下に無い従業員 ID を混ぜたときの API の挙動も未検証で、一覧が取り切れているときは API を呼ばずに拒否します。';

const CORRECTION =
  'この人の過去の打刻は API では修正できません。勤怠Plus の Web 画面から修正申請をしてください。punch は操作している本人の打刻になるので、チームの締めでは呼ばないでください。';

/** 打刻が取れなかったときに、打刻の欠落そのものを問題にしない種別 */
const STAMP_ABSENCE: ReadonlySet<IssueType> = new Set([
  'no_punches_on_workday',
  'missing_clock_out',
  'missing_clock_in',
  'missing_break_end',
  'duplicate_clock_in',
]);

export interface TeamMemberRef {
  staffId: number;
  name?: string;
  staffNum?: string;
}

export interface TeamDayIssue {
  date: LocalDate;
  code: IssueType | 'short_break';
  severity: IssueSeverity;
  title: string;
  detail: string;
}

export interface TeamOvertime {
  level: Exclude<RiskLevel, 'ok'>;
  overtimeSoFarMinutes: number;
  overtimeSoFarHours: string;
  projectedOvertimeMinutes: number;
  projectedOvertimeHours: string;
  limitHours: number;
  watchHours: number;
  estimated: boolean;
  detail: string;
}

export interface TeamMemberReport {
  staffId: number;
  name?: string;
  staffNum?: string;
  days: TeamDayIssue[];
  overtime?: TeamOvertime;
}

export interface TeamAbsentMember {
  staffId: number;
  name?: string;
  staffNum?: string;
  note: string;
}

export interface TeamCloseoutReport {
  scope: 'day' | 'month';
  timezone: 'Asia/Tokyo';
  today: LocalDate;
  date?: LocalDate;
  month: string;
  from: LocalDate;
  to: LocalDate;
  staffCount: number;
  needsActionCount: number;
  noIssueCount: number;
  ok: boolean;
  headline: string;
  members: TeamMemberReport[];
  noActivity: TeamAbsentMember[];
  unsupported: readonly string[];
  overtimeThresholds: { limitHours: number; watchHours: number };
  breakTimeUnknown: boolean;
  disclaimer: string;
  note: string;
  gaps?: string[];
}

export interface TeamCloseoutInput {
  scope: 'day' | 'month';
  today: LocalDate;
  /** scope=day の対象日 */
  date: LocalDate;
  /** YYYY-MM */
  month: string;
  thresholdHours: number;
  members: readonly TeamMemberRef[];
  records: readonly WorkingRecord[];
  stamps: readonly Stamp[];
  /** 勤務実績の取得に失敗した */
  recordsOk: boolean;
  /** 打刻の取得に失敗した */
  stampsOk: boolean;
  gaps?: readonly string[];
}

interface ClosedShift {
  date: LocalDate;
  startAt: Date;
  endAt: Date;
  workedMinutes: number;
  breakMinutes: number;
}

const isIn = (s: Stamp) => s.type === 'clock_in' || s.type === 'direct_in';
const isOut = (s: Stamp) => s.type === 'clock_out' || s.type === 'direct_out';

/**
 * 管理下メンバーの 1 日または 1 か月の残件。
 * 勤務実績を主にし、打刻は休憩と打刻の形（重複・出勤無し）の補助に使う。
 * 今日の進行中は退勤漏れにしない。問題が無い人は人数だけ、実績も打刻も無い人は別にする。
 */
export function buildTeamCloseout(input: TeamCloseoutInput): TeamCloseoutReport {
  const { today, scope } = input;
  const monthStart = `${input.month}-01`;
  const monthEnd = endOfMonth(monthStart);
  // biome-ignore lint/complexity/useMathMinMax: YYYY-MM-DD の文字列比較なので Math.min は使えない
  const throughToday = monthEnd < today ? monthEnd : today;
  const from = scope === 'day' ? input.date : monthStart;
  const to = scope === 'day' ? input.date : throughToday;
  const yesterday = addDays(today, -1);
  // biome-ignore lint/complexity/useMathMinMax: YYYY-MM-DD の文字列比較なので Math.min は使えない
  const pastTo = to < yesterday ? to : yesterday;
  const watchHours = Math.round(input.thresholdHours * 0.8);
  const incomplete = !input.recordsOk || !input.stampsOk || (input.gaps?.length ?? 0) > 0;
  const shifts = input.stampsOk ? closedShifts(input.stamps) : [];

  const members: TeamMemberReport[] = [];
  const noActivity: TeamAbsentMember[] = [];
  let breakTimeUnknown = false;

  for (const person of [...input.members].sort((a, b) => a.staffId - b.staffId)) {
    const records = input.records.filter((r) => r.staffId === person.staffId);
    const stamps = input.stamps.filter((s) => s.staffId === person.staffId);
    if (records.some((r) => readWorkingMinutes(r).basis === 'statutory_minimum')) {
      breakTimeUnknown = true;
    }
    if (isAbsent(person, records, stamps, from, to, input)) {
      noActivity.push({
        ...identity(person),
        note: '期間中の勤務実績も打刻もありません。休職・退職の可能性があります。在籍しているなら勤怠Plus の画面で確認してください。',
      });
      continue;
    }
    const days = dayIssues(
      person.staffId,
      records,
      stamps,
      shifts,
      from,
      to,
      pastTo,
      input.stampsOk,
    );
    const overtime = overtimeFor(records, input, monthStart, monthEnd, yesterday, watchHours);
    if (days.length === 0 && !overtime) continue;
    members.push({
      ...identity(person),
      days,
      ...(overtime ? { overtime } : {}),
    });
  }

  const needsActionCount = members.length;
  const noIssueCount = input.members.length - needsActionCount - noActivity.length;
  const ok =
    input.members.length > 0 && needsActionCount === 0 && noActivity.length === 0 && !incomplete;
  const gaps = input.gaps ? [...input.gaps] : [];
  const report: TeamCloseoutReport = {
    scope,
    timezone: 'Asia/Tokyo',
    today,
    ...(scope === 'day' ? { date: input.date } : {}),
    month: input.month,
    from,
    to,
    staffCount: input.members.length,
    needsActionCount,
    noIssueCount,
    ok,
    headline: headlineFor(input.members.length, needsActionCount, noActivity.length, incomplete),
    members,
    noActivity,
    unsupported: TEAM_UNSUPPORTED,
    overtimeThresholds: { limitHours: input.thresholdHours, watchHours },
    breakTimeUnknown,
    disclaimer: breakTimeUnknown
      ? `${CLOSEOUT_DISCLAIMER} ${UNKNOWN_BREAK_NOTE}`
      : CLOSEOUT_DISCLAIMER,
    note: noteFor(from, to, today),
  };
  if (gaps.length > 0) report.gaps = gaps;
  return report;
}

function identity(person: TeamMemberRef): Pick<TeamMemberReport, 'staffId' | 'name' | 'staffNum'> {
  return {
    staffId: person.staffId,
    ...(person.name !== undefined ? { name: person.name } : {}),
    ...(person.staffNum !== undefined ? { staffNum: person.staffNum } : {}),
  };
}

function isAbsent(
  _person: TeamMemberRef,
  records: readonly WorkingRecord[],
  stamps: readonly Stamp[],
  from: LocalDate,
  to: LocalDate,
  input: TeamCloseoutInput,
): boolean {
  if (!input.recordsOk || !input.stampsOk) return false;
  const hasRecord = records.some((r) => r.date >= from && r.date <= to);
  const hasStamp = stamps.some((s) => {
    const date = toLocalDate(s.stampedAt);
    return date >= from && date <= to;
  });
  return !hasRecord && !hasStamp;
}

function dayIssues(
  staffId: number,
  records: readonly WorkingRecord[],
  stamps: readonly Stamp[],
  shifts: readonly TaggedShift[],
  from: LocalDate,
  to: LocalDate,
  pastTo: LocalDate,
  stampsOk: boolean,
): TeamDayIssue[] {
  const found =
    from <= pastTo
      ? findAttendanceIssues({
          range: { from, to: pastTo },
          records,
          stamps,
        })
      : [];
  const days: TeamDayIssue[] = [];
  for (const issue of found) {
    if (issue.severity === 'info') continue;
    if (!stampsOk && STAMP_ABSENCE.has(issue.type)) continue;
    days.push(issueItem(issue));
  }
  if (from <= to) {
    for (let i = 0; i <= diffDays(from, to); i++) {
      const date = addDays(from, i);
      const record = records.find((r) => r.date === date);
      const account = stampsOk ? accountFor(shifts, staffId, date) : undefined;
      const item = shortBreakItem(date, record, account);
      if (item) days.push(item);
    }
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.code < b.code ? -1 : 1));
  return days;
}

function issueItem(issue: AttendanceIssue): TeamDayIssue {
  return {
    date: issue.date,
    code: issue.type,
    severity: issue.severity,
    title: issue.message,
    detail: `${issue.message} ${CORRECTION}`,
  };
}

function shortBreakItem(
  date: LocalDate,
  record: WorkingRecord | undefined,
  account: { workedMinutes: number; breakMinutes: number } | undefined,
): TeamDayIssue | undefined {
  // 休憩打刻が無い日は不足と断定しない。システムが休憩を引いていることがある。
  if (record?.breakMinutes === undefined && (account?.breakMinutes ?? 0) === 0) return undefined;
  const worked = recordedNetMinutes(record) ?? account?.workedMinutes;
  if (worked === undefined) return undefined;
  const breakMin = record?.breakMinutes ?? account?.breakMinutes ?? 0;
  const source = record?.breakMinutes !== undefined ? '勤務実績の休憩' : '打刻の休憩';
  return violation(date, worked, breakMin, source);
}

function violation(
  date: LocalDate,
  worked: number,
  breakMin: number,
  source: string,
): TeamDayIssue | undefined {
  const need = requiredBreakMinutes(worked);
  if (need === 0 || breakMin >= need) return undefined;
  const title = breakMin === 0 ? '休憩がありません' : `休憩が ${breakMin} 分しかありません`;
  return {
    date,
    code: 'short_break',
    severity: 'error',
    title,
    detail:
      `${source}は ${breakMin} 分、実働は ${formatHm(worked)}。${BREAK_RULE}` +
      `必要 ${need} 分、あと ${need - breakMin} 分足りません。${CORRECTION}`,
  };
}

function overtimeFor(
  records: readonly WorkingRecord[],
  input: TeamCloseoutInput,
  monthStart: LocalDate,
  monthEnd: LocalDate,
  yesterday: LocalDate,
  watchHours: number,
): TeamOvertime | undefined {
  if (!input.recordsOk) return undefined;
  const asOfCandidate = yesterday < monthEnd ? yesterday : monthEnd;
  const asOf = asOfCandidate >= monthStart ? asOfCandidate : addDays(monthStart, -1);
  const monthRecords = records.filter((r) => r.date >= monthStart && r.date <= monthEnd);
  const risk = assessOvertimeRisk({
    records: monthRecords,
    asOf,
    monthEnd,
    thresholdMinutes: input.thresholdHours * 60,
  });
  if (risk.level === 'ok') return undefined;
  const estimated = monthRecords.some((r) => readWorkingMinutes(r).basis === 'statutory_minimum');
  const soFar = formatHm(risk.overtimeSoFarMinutes);
  const projected = formatHm(risk.projectedOvertimeMinutes);
  const title =
    risk.level === 'over'
      ? `法定時間外の目安が、すでに ${input.thresholdHours} 時間を超えています`
      : risk.level === 'likely'
        ? `このペースだと ${input.thresholdHours} 時間を超えそうです`
        : `残業の目安が ${watchHours} 時間（しきい値の 8 割）に届きそうです`;
  return {
    level: risk.level,
    overtimeSoFarMinutes: risk.overtimeSoFarMinutes,
    overtimeSoFarHours: soFar,
    projectedOvertimeMinutes: risk.projectedOvertimeMinutes,
    projectedOvertimeHours: projected,
    limitHours: input.thresholdHours,
    watchHours,
    estimated,
    detail:
      `${title}。${input.month} の目安はここまで ${soFar}、月末の着地予測は ${projected}。` +
      `ラインは ${watchHours} 時間と ${input.thresholdHours} 時間（既定の 45 時間は 36 協定の原則の月上限、36 時間はその 8 割）です。` +
      (estimated ? '休憩が不明な日は法定の最低休憩を引いた見積もりです。' : '') +
      '正式な値は勤怠Plus で確認してください。',
  };
}

function accountFor(
  shifts: readonly TaggedShift[],
  staffId: number,
  date: LocalDate,
): { workedMinutes: number; breakMinutes: number } | undefined {
  const own = shifts
    .filter((s) => s.date === date && s.staffId === staffId)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  if (own.length === 0) return undefined;
  let worked = 0;
  let brk = 0;
  for (let i = 0; i < own.length; i++) {
    const shift = own[i];
    if (!shift) continue;
    worked += shift.workedMinutes;
    brk += shift.breakMinutes;
    const prev = own[i - 1];
    if (!prev) continue;
    const gap = Math.round((shift.startAt.getTime() - prev.endAt.getTime()) / 60_000);
    if (gap > 0) brk += gap;
  }
  return { workedMinutes: worked, breakMinutes: brk };
}

interface TaggedShift extends ClosedShift {
  staffId: number;
}

/** 16 時間以内に退勤で閉じた勤務。日をまたぐ休憩も 1 つの勤務にし、開いている勤務は数えない。 */
function closedShifts(stamps: readonly Stamp[]): TaggedShift[] {
  const byStaff = new Map<number, Stamp[]>();
  for (const stamp of stamps) {
    if (stamp.staffId === undefined) continue;
    const list = byStaff.get(stamp.staffId);
    if (list) list.push(stamp);
    else byStaff.set(stamp.staffId, [stamp]);
  }
  const out: TaggedShift[] = [];
  for (const [staffId, list] of byStaff) {
    for (const shift of shiftsOf(list)) out.push({ ...shift, staffId });
  }
  return out;
}

function shiftsOf(stamps: readonly Stamp[]): ClosedShift[] {
  const sorted = [...stamps].sort((a, b) => a.stampedAt.getTime() - b.stampedAt.getTime());
  const maxMs = MAX_OVERNIGHT_SHIFT_MINUTES * 60_000;
  const out: ClosedShift[] = [];
  let open:
    | {
        startAt: Date;
        startDate: LocalDate;
        workedMs: number;
        breakMs: number;
        since: number;
        onBreak: boolean;
      }
    | undefined;
  for (const stamp of sorted) {
    const t = stamp.stampedAt.getTime();
    if (isIn(stamp)) {
      if (!open) {
        open = {
          startAt: stamp.stampedAt,
          startDate: toLocalDate(stamp.stampedAt),
          workedMs: 0,
          breakMs: 0,
          since: t,
          onBreak: false,
        };
      }
    } else if (stamp.type === 'break_start' && open && !open.onBreak) {
      open.workedMs += t - open.since;
      open.onBreak = true;
      open.since = t;
    } else if (stamp.type === 'break_end' && open?.onBreak) {
      open.breakMs += t - open.since;
      open.onBreak = false;
      open.since = t;
    } else if (isOut(stamp) && open) {
      const elapsed = t - open.startAt.getTime();
      if (elapsed >= 0 && elapsed <= maxMs) {
        if (open.onBreak) open.breakMs += t - open.since;
        else open.workedMs += t - open.since;
        out.push({
          date: open.startDate,
          startAt: open.startAt,
          endAt: stamp.stampedAt,
          workedMinutes: Math.floor(open.workedMs / 60_000),
          breakMinutes: Math.floor(open.breakMs / 60_000),
        });
      }
      open = undefined;
    }
  }
  return out;
}

function headlineFor(
  staffCount: number,
  needs: number,
  absent: number,
  incomplete: boolean,
): string {
  if (staffCount === 0) return '管理下の従業員がいません。';
  if (needs === 0 && absent === 0 && !incomplete) {
    return '対応は不要です。管理下のメンバーに、この期間の残件はありません。';
  }
  if (needs === 0 && absent === 0) {
    return '一部のデータを取れなかったため、締められるとは断定できません。';
  }
  const absentText =
    absent > 0
      ? `別に、期間中に実績も打刻も無い人が ${absent} 人います（休職・退職の可能性があります）。`
      : '';
  const needsText =
    needs > 0
      ? `${needs} 人に対応が必要な日があります。members を確認してください。`
      : '打刻と勤務実績で対応が必要な人はいません。';
  const gapText = incomplete
    ? '一部のデータを取れなかったため、これで全部とは断定できません。'
    : '';
  return `${needsText}${absentText}${gapText}`;
}

function noteFor(from: LocalDate, to: LocalDate, today: LocalDate): string {
  const todayNote =
    from <= today && today <= to
      ? '今日は進行中です。退勤していないことだけでは残件にしません。今日だれが出ているかは get_team_stamps です。'
      : '';
  return `${TEAM_ESTIMATE_NOTE}${todayNote}休憩打刻が無い日は、システムが休憩を引いている可能性があるので不足とは断定しません。打刻の修正は API ではできません。過去の打刻は勤怠Plus の Web 画面から修正申請してください。`;
}

function formatHm(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  return `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}
