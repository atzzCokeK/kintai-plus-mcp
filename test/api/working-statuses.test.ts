import { describe, expect, it } from 'vitest';
import { parseWorkingStatuses } from '../../src/api/working-statuses.ts';

describe('parseWorkingStatuses', () => {
  it('従業員・日付ごとの勤務処理のラベルを読む（形の揺れに寛容）', () => {
    expect(
      parseWorkingStatuses({
        working_statuses: [
          { staff_id: 1, date: '2026-10-27', working_statuses: [{ name: '出張' }, '在宅'] },
          { staff_id: 2, date: '2026/10/27', name: '欠勤' },
          { staff_id: 3, date: '2026-10-27', working_statuses: [] },
        ],
      }),
    ).toEqual([
      { staffId: 1, date: '2026-10-27', labels: ['出張', '在宅'] },
      { staffId: 2, date: '2026-10-27', labels: ['欠勤'] },
      { staffId: 3, date: '2026-10-27', labels: [] },
    ]);
  });

  it('配列そのものも読む。staff_id・date のないものは捨てる', () => {
    expect(
      parseWorkingStatuses([{ staff_id: 1, date: '2026-10-27', status_name: '休暇' }, { foo: 1 }]),
    ).toEqual([{ staffId: 1, date: '2026-10-27', labels: ['休暇'] }]);
  });
});
