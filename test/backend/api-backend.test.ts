import { describe, expect, it } from 'vitest';
import { ApiBackend } from '../../src/backend/api-backend.ts';
import { ALL_CAPABILITIES } from '../../src/backend/types.ts';
import { fakeClient } from '../helpers/fake-client.ts';

describe('ApiBackend', () => {
  it('API 版は v1 の機能をすべて申告する', () => {
    const { client } = fakeClient(() => ({}));
    const backend = new ApiBackend(client);
    expect(backend.kind).toBe('api');
    expect([...backend.capabilities].sort()).toEqual([...ALL_CAPABILITIES].sort());
  });

  it('getMyProfile は自分の従業員情報と権限を返す（必要最小限の項目）', async () => {
    const { client, calls } = fakeClient(() => ({
      staffId: 7,
      lastName: '山田',
      firstName: '花子',
      email: 'hanako@example.com',
      staffNum: 'E0007',
      organization: { name: '開発部' },
      permissionGroup: { permissionType: 1 },
    }));
    const profile = await new ApiBackend(client).getMyProfile();
    expect(calls[0]?.url.pathname).toBe('/api/cooperation/acme/staffs');
    expect(profile).toEqual({
      staffId: 7,
      name: '山田 花子',
      staffNum: 'E0007',
      organizationName: '開発部',
      role: 'company_admin',
    });
  });

  it('プロフィールは一度取ったら使い回す（権限判定で何度も呼ばない）', async () => {
    const { client, calls } = fakeClient(() => ({
      staffId: 7,
      permissionGroup: { permissionType: 3 },
    }));
    const backend = new ApiBackend(client);
    await backend.getMyProfile();
    await backend.getMyProfile();
    expect(calls).toHaveLength(1);
    expect((await backend.getMyProfile()).role).toBe('employee');
  });

  it('権限が読めない場合は従業員として扱う', async () => {
    const { client } = fakeClient(() => ({ staffId: 7 }));
    expect((await new ApiBackend(client).getMyProfile()).role).toBe('employee');
  });
});

describe('ApiBackend の自分の staffId', () => {
  it('保存済みの staffId があれば /staffs/{staffId} で自分を取る', async () => {
    const { client, calls } = fakeClient(() => ({
      staffId: 7,
      permissionGroup: { permissionType: 2 },
    }));
    const backend = new ApiBackend(client, { knownStaffId: async () => 7 });
    expect((await backend.getMyProfile()).role).toBe('admin');
    expect(calls[0]?.url.pathname).toBe('/api/cooperation/acme/staffs/7');
  });
});
