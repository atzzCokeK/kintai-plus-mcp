import { describe, expect, it } from 'vitest';
import { anonymize } from '../../e2e/anonymize.ts';

describe('anonymize', () => {
  const raw = {
    success: true,
    response: {
      staffId: 101,
      lastName: '仮山',
      firstName: '太一',
      lastNameKana: 'カリヤマ',
      firstNameKana: 'タイチ',
      email: 'taichi.kariyama@sample-corp.example',
      staffNum: 'A-99812',
      organization: { organizationId: 5, name: '経営企画本部' },
      managedOrganizations: [{ organizationId: 6, name: '人事部' }],
      stamps: [
        {
          stamped_at: '2026/10/27 09:00:00',
          attributes: { latitude: 35.68123, longitude: 139.76712, ip: '203.0.113.77', method: 1 },
        },
      ],
      token: 'real-token-value',
    },
  };

  it('氏名・カナ・メール・社員番号・部署名・位置情報・IP・トークンを架空の値にする', () => {
    const out = JSON.stringify(anonymize(raw));
    for (const secret of [
      '仮山',
      '太一',
      'カリヤマ',
      'タイチ',
      'sample-corp',
      'A-99812',
      '経営企画本部',
      '人事部',
      '35.68123',
      '139.76712',
      '203.0.113.77',
      'real-token-value',
    ]) {
      expect(out).not.toContain(secret);
    }
  });

  it('構造・ID・日時・コード値は保つ', () => {
    const out = anonymize(raw) as typeof raw;
    expect(out.response.staffId).toBe(101);
    expect(out.response.organization.organizationId).toBe(5);
    expect(out.response.stamps[0]?.stamped_at).toBe('2026/10/27 09:00:00');
    expect(out.response.stamps[0]?.attributes.method).toBe(1);
    expect(typeof out.response.email).toBe('string');
    expect(out.response.email).toMatch(/@example\.com$/);
  });

  it('同じ値は同じ架空の値になる（関係を保つ）', () => {
    const out = anonymize([
      { name: '経営企画本部' },
      { name: '経営企画本部' },
      { name: '人事部' },
    ]) as Array<{
      name: string;
    }>;
    expect(out[0]?.name).toBe(out[1]?.name);
    expect(out[0]?.name).not.toBe(out[2]?.name);
  });
});
