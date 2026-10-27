import { describe, expect, it } from 'vitest';
import {
  parseProjectMembers,
  parseProjects,
  parseStaffProjectIds,
  parseTasks,
  readTotalCount,
} from '../../src/api/projects.ts';

describe('parseProjects', () => {
  it('プロジェクトの項目を読む', () => {
    expect(
      parseProjects({
        projects: [
          {
            project_id: 3,
            name: '社内基盤',
            short_name: '基盤',
            project_code: 'P003',
            start_date: '2026/04/01',
            end_date: null,
          },
        ],
        TotalCount: 1,
      }),
    ).toEqual([
      { projectId: 3, name: '社内基盤', shortName: '基盤', code: 'P003', startDate: '2026-04-01' },
    ]);
  });

  it('配列そのものも読む。ID のないものは捨てる', () => {
    expect(parseProjects([{ project_id: 1, name: 'A' }, { name: 'no id' }])).toEqual([
      { projectId: 1, name: 'A' },
    ]);
  });
});

describe('readTotalCount', () => {
  it('TotalCount / total_count / totalCount を読む', () => {
    expect(readTotalCount({ TotalCount: 45 })).toBe(45);
    expect(readTotalCount({ total_count: '3' })).toBe(3);
    expect(readTotalCount({ totalCount: 0 })).toBe(0);
    expect(readTotalCount([])).toBeUndefined();
  });
});

describe('parseTasks', () => {
  it('タスクの項目を読む（見積もりは分、終了フラグ）', () => {
    expect(
      parseTasks({
        tasks: [
          { task_id: 10, name: '設計', code: 'T10', estimated_hour: 600, is_finished: false },
          { task_id: 11, name: '旧タスク', is_finished: true },
        ],
      }),
    ).toEqual([
      { taskId: 10, name: '設計', code: 'T10', estimatedMinutes: 600, finished: false },
      { taskId: 11, name: '旧タスク', finished: true },
    ]);
  });
});

describe('parseStaffProjectIds', () => {
  it('ID の配列・プロジェクトの配列のどちらでも ID を取り出す', () => {
    expect(parseStaffProjectIds({ project_ids: [1, 2] })).toEqual([1, 2]);
    expect(parseStaffProjectIds({ projects: [{ project_id: 5, name: 'X' }] })).toEqual([5]);
    expect(parseStaffProjectIds([{ project_id: 6 }, 7])).toEqual([6, 7]);
  });
});

describe('parseProjectMembers', () => {
  it('staff_ids と owner_staff_ids を読む', () => {
    expect(parseProjectMembers({ staff_ids: [1, 2, 3], owner_staff_ids: [1] })).toEqual({
      staffIds: [1, 2, 3],
      ownerStaffIds: [1],
    });
    expect(parseProjectMembers(null)).toEqual({ staffIds: [], ownerStaffIds: [] });
  });
});
