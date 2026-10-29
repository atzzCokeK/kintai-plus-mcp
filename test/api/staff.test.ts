import { describe, expect, it } from 'vitest';
import { parseStaff, permissionRole } from '../../src/api/staff.ts';

describe('parseStaff', () => {
  it('camelCase の項目を読む（架空のデータ）', () => {
    const staff = parseStaff({
      staffId: 101,
      lastName: '山田',
      firstName: '花子',
      email: 'hanako@example.com',
      staffNum: 'E0001',
      organization: { organizationId: 3, name: '開発部' },
      permissionGroup: { permissionType: 2, name: '一般管理者' },
    });
    expect(staff).toEqual({
      staffId: 101,
      name: '山田 花子',
      email: 'hanako@example.com',
      staffNum: 'E0001',
      organizationName: '開発部',
      permissionType: 2,
    });
  });

  it('所属名は organization.Name を読む', () => {
    const staff = parseStaff({
      staffId: 101,
      lastName: '架空',
      firstName: '花子',
      organization: { Name: '開発部' },
      permissionGroup: { permissionType: 2, Name: '一般管理者' },
      Subgroups: [],
    });
    expect(staff).toMatchObject({
      staffId: 101,
      name: '架空 花子',
      organizationName: '開発部',
      permissionType: 2,
    });
  });

  it('snake_case や配列・ラップされた応答も読む', () => {
    const inner = { staff_id: 5, last_name: '佐藤', first_name: '太郎', permission_type: 3 };
    expect(parseStaff([inner])).toMatchObject({ staffId: 5, name: '佐藤 太郎', permissionType: 3 });
    expect(parseStaff({ staffs: [inner] })).toMatchObject({ staffId: 5 });
    expect(parseStaff({ staff: inner })).toMatchObject({ staffId: 5 });
  });

  it('staffId がなければ undefined', () => {
    expect(parseStaff({ foo: 1 })).toBeUndefined();
    expect(parseStaff(null)).toBeUndefined();
  });
});

describe('permissionRole', () => {
  it('1=企業管理者 2=一般管理者 3=従業員', () => {
    expect(permissionRole(1)).toBe('company_admin');
    expect(permissionRole(2)).toBe('admin');
    expect(permissionRole(3)).toBe('employee');
  });

  it('不明な値は最も弱い従業員とみなす（管理者ツールを誤って見せない）', () => {
    expect(permissionRole(undefined)).toBe('employee');
    expect(permissionRole(9)).toBe('employee');
  });
});

describe('parseStaffList', () => {
  it('一覧の形（配列・{ staffs }）から全員を読む', async () => {
    const { parseStaffList } = await import('../../src/api/staff.ts');
    const list = [
      { staffId: 1, lastName: 'A', firstName: 'a' },
      { staff_id: 2, name: 'B b' },
      { foo: 'no id' },
    ];
    expect(parseStaffList(list).map((s) => s.staffId)).toEqual([1, 2]);
    expect(parseStaffList({ staffs: list, TotalCount: 2 }).map((s) => s.staffId)).toEqual([1, 2]);
    expect(parseStaffList({ staffId: 9 }).map((s) => s.staffId)).toEqual([9]);
  });
});

describe('fetchMyStaff', () => {
  it('自分の staffId がわかっていれば /staffs/{staffId} で取り、一覧なら一致する人を選ぶ', async () => {
    const { fetchMyStaff } = await import('../../src/api/staff.ts');
    const { fakeClient } = await import('../helpers/fake-client.ts');
    const { client, calls } = fakeClient(() => [{ staffId: 1 }, { staffId: 7, permissionType: 3 }]);
    const me = await fetchMyStaff(client, { staffId: 7 });
    expect(calls[0]?.url.pathname).toBe('/api/cooperation/acme/staffs/7');
    expect(me.staffId).toBe(7);
  });

  it('一覧が複数人のときは GET /stamps の staff_id で自分を決める', async () => {
    const { fetchMyStaff } = await import('../../src/api/staff.ts');
    const { fakeClient } = await import('../helpers/fake-client.ts');
    const { client, calls } = fakeClient((_method, url) => {
      if (url.pathname.endsWith('/stamps')) {
        return { login_company_code: 'acme', staff_id: '7', count: 0, stamps: [] };
      }
      if (url.pathname.endsWith('/staffs/7')) {
        return {
          staffId: 7,
          lastName: '架空',
          firstName: '花子',
          organization: { Name: '開発部' },
          permissionGroup: { permissionType: 1, Name: '企業管理者' },
        };
      }
      return {
        login_company_code: 'acme',
        Count: 2,
        TotalCount: 2,
        staffs: [
          {
            staffId: 1,
            lastName: '仮名',
            firstName: '次郎',
            permissionGroup: { permissionType: 3 },
          },
          {
            staffId: 2,
            lastName: '見本',
            firstName: '三郎',
            permissionGroup: { permissionType: 3 },
          },
        ],
      };
    });
    const me = await fetchMyStaff(client);
    expect(me).toMatchObject({
      staffId: 7,
      name: '架空 花子',
      organizationName: '開発部',
      permissionType: 1,
    });
    expect(calls.map((c) => c.url.pathname)).toEqual([
      '/api/cooperation/acme/staffs',
      '/api/cooperation/acme/stamps',
      '/api/cooperation/acme/staffs/7',
    ]);
  });

  it('stamps の応答に staff_id が無ければ自分を決められない', async () => {
    const { fetchMyStaff } = await import('../../src/api/staff.ts');
    const { fakeClient } = await import('../helpers/fake-client.ts');
    const { client } = fakeClient(() => [{ staffId: 1, permissionType: 1 }, { staffId: 7 }]);
    await expect(fetchMyStaff(client)).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});
