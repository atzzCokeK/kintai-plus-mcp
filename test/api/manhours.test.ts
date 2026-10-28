import { describe, expect, it } from 'vitest';
import { parseManhours } from '../../src/api/manhours.ts';

const day = {
  date: '2026/10/27',
  comment: '定例と設計',
  closed_at: null,
  fixed_at: '2026/10/28 10:00:00',
  projects: [
    {
      project_id: 3,
      daily_hour_items: [
        { task_id: 10, minute: 120 },
        { task_id: 11, minute: 30 },
      ],
    },
    { project_id: 4, daily_hour_items: [{ task_id: 20, minute: 60 }] },
  ],
};

describe('parseManhours', () => {
  it('日ごと・プロジェクトごと・タスクごとの分を読み、合計を出す', () => {
    expect(parseManhours({ dates: [day] })).toEqual([
      {
        date: '2026-10-27',
        comment: '定例と設計',
        closed: false,
        fixed: true,
        totalMinutes: 210,
        projects: [
          {
            projectId: 3,
            totalMinutes: 150,
            items: [
              { taskId: 10, minutes: 120 },
              { taskId: 11, minutes: 30 },
            ],
          },
          { projectId: 4, totalMinutes: 60, items: [{ taskId: 20, minutes: 60 }] },
        ],
      },
    ]);
  });

  it('従業員ごとに包まれた形も読み、staffId を付ける', () => {
    const days = parseManhours({ manhours: [{ staff_id: 7, dates: [day] }] });
    expect(days[0]?.staffId).toBe(7);
  });

  it('工数のない日（projects が空）も残す', () => {
    const days = parseManhours([{ staff_id: 7, dates: [{ date: '2026/10/26', projects: [] }] }]);
    expect(days).toEqual([
      {
        staffId: 7,
        date: '2026-10-26',
        closed: false,
        fixed: false,
        totalMinutes: 0,
        projects: [],
      },
    ]);
  });
});
