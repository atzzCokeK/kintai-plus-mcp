import { describe, expect, it } from 'vitest';
import { alertLabel, parseAlerts } from '../../src/api/alerts.ts';

describe('parseAlerts', () => {
  it('month・date・alert_type を読み、日付順に並べる', () => {
    const alerts = parseAlerts({
      alerts: [
        { month: '2026/10', date: '2026/10/20', alert_type: 7 },
        { month: '2026/10', date: '2026/10/02', alert_type: 1 },
        { month: '2026/09', date: null, alert_type: 13 },
      ],
    });
    expect(alerts).toEqual([
      { month: '2026-09', type: 13, label: '36協定' },
      { month: '2026-10', date: '2026-10-02', type: 1, label: '打刻忘れ' },
      { month: '2026-10', date: '2026-10-20', type: 7, label: '遅刻' },
    ]);
  });

  it('配列そのものも受け付ける。不明な種別は番号付きのラベル', () => {
    expect(parseAlerts([{ month: '202610', date: '20261001', alert_type: 99 }])).toEqual([
      { month: '2026-10', date: '2026-10-01', type: 99, label: 'その他（種別 99）' },
    ]);
  });

  it('alertLabel', () => {
    expect(alertLabel(22)).toBe('工数未入力');
  });
});
