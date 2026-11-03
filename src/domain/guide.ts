import { STAMP_TYPE_CODES, STAMP_TYPE_LABEL, type StampType } from '../api/stamps.ts';
import { BREAK_RULE, CLOSEOUT_DISCLAIMER, requiredBreakMinutes } from './close-out.ts';

const STAMP_NOTES: Record<StampType, string> = {
  clock_in: '出勤。テレワークを付けられるのはこの種別だけ。',
  clock_out: '退勤。',
  direct_in: '直行。勤務先へ直接向かう出勤。',
  direct_out: '直帰。勤務先から直接帰る退勤。',
  break_start: '休憩に入る。',
  break_end: '休憩から戻る。',
};

/**
 * 就業ルールと打刻種別の説明。ライブの勤怠データは含まない。
 * ツール `get_attendance_guide` とリソース `kintai://guide` が同じ関数を返す。
 */
export function attendanceGuide() {
  const stampTypes = (Object.keys(STAMP_TYPE_CODES) as StampType[]).map((type) => ({
    type,
    code: STAMP_TYPE_CODES[type],
    label: STAMP_TYPE_LABEL[type],
    note: STAMP_NOTES[type],
  }));
  return {
    timezone: 'Asia/Tokyo' as const,
    static: true as const,
    note: 'これは就業ルールの説明です。今日の状態は get_today_status、1日または月の残件は close_out を使ってください。',
    stampTypes,
    punch: {
      typeRequired: true,
      noAutoToggle:
        '打刻種別は省略できません。API の「省略すると出勤と退勤を自動で切り替える」は使いません。',
      recordedAt:
        '打刻はクラウド勤怠Plus が受け取った時刻で記録されます。API からは修正・削除・過去時刻の指定ができません。',
      correction:
        '間違えた打刻は、Web 画面の修正申請（打刻修正）で直します。punch を重ねても上書きになりません。',
      conflict:
        'その日の打刻と矛盾する操作（出勤中の出勤、休憩中の退勤など）は拒否します。本人が明示したときだけ force: true で実行できます。',
    },
    statutoryBreak: {
      law: '労働基準法 34 条',
      rule: BREAK_RULE,
      examples: [
        { workedMinutes: 6 * 60, requiredBreakMinutes: requiredBreakMinutes(6 * 60) },
        { workedMinutes: 6 * 60 + 1, requiredBreakMinutes: requiredBreakMinutes(6 * 60 + 1) },
        { workedMinutes: 8 * 60, requiredBreakMinutes: requiredBreakMinutes(8 * 60) },
        { workedMinutes: 8 * 60 + 1, requiredBreakMinutes: requiredBreakMinutes(8 * 60 + 1) },
      ],
      countedFrom:
        '休憩の長さは打刻（休憩入から休憩戻）で数えます。勤務実績 API は休憩時間を返しません。',
    },
    overtimeEstimate: CLOSEOUT_DISCLAIMER,
  };
}
