import { describe, expect, it } from 'vitest';
import { minimizeStaff, stripLocation } from '../src/privacy.ts';

describe('stripLocation', () => {
  const stamp = {
    stamped_at: '2026/10/27 09:00:00',
    attributes: { method: 1, latitude: 35.6, longitude: 139.7, ip: '192.0.2.1', org_id: 3 },
    nested: [{ lat: 1, lng: 2, ip_address: '198.51.100.1', keep: true }],
  };

  it('緯度・経度・IP を深い階層まで取り除く（元の値は変更しない）', () => {
    const out = stripLocation(stamp, false);
    expect(out).toEqual({
      stamped_at: '2026/10/27 09:00:00',
      attributes: { method: 1, org_id: 3 },
      nested: [{ keep: true }],
    });
    expect(stamp.attributes.latitude).toBe(35.6);
  });

  it('含める設定ならそのまま', () => {
    expect(stripLocation(stamp, true)).toEqual(stamp);
  });
});

describe('minimizeStaff', () => {
  it('ID・氏名・社員番号・所属だけにする（メールなどは渡さない）', () => {
    expect(
      minimizeStaff({
        staffId: 1,
        name: '山田 花子',
        email: 'x@example.com',
        staffNum: 'E1',
        organizationName: '開発部',
        permissionType: 2,
      }),
    ).toEqual({ staffId: 1, name: '山田 花子', staffNum: 'E1', organizationName: '開発部' });
  });
});
