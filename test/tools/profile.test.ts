import { describe, expect, it } from 'vitest';
import { getMyProfileTool } from '../../src/tools/profile.ts';
import { fakeBackend, fakeContext } from '../helpers/fake-backend.ts';

describe('get_my_profile', () => {
  it('自分の従業員情報・権限・日本時間の今日を返す', async () => {
    const backend = fakeBackend({
      getMyProfile: async () => ({
        staffId: 7,
        name: '山田 花子',
        organizationName: '開発部',
        role: 'admin',
      }),
    });
    const out = await getMyProfileTool.handler({}, fakeContext(backend));
    expect(out).toEqual({
      staffId: 7,
      name: '山田 花子',
      organizationName: '開発部',
      role: 'admin',
      roleLabel: '一般管理者',
      today: '2026-10-27',
      timezone: 'Asia/Tokyo',
    });
  });
});
