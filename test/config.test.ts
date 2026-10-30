import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('既定値', () => {
    expect(loadConfig({})).toEqual({
      refreshBeforeDays: 15,
      autoRefresh: true,
      readOnly: false,
      confirmWrites: false,
      includeLocation: false,
      logLevel: 'info',
      minIntervalMs: 300,
      persistEnvToken: false,
    });
  });

  it('環境変数で変更できる', () => {
    expect(
      loadConfig({
        KINTAI_PLUS_REFRESH_DAYS: '7',
        KINTAI_PLUS_AUTO_REFRESH: 'false',
        KINTAI_PLUS_READ_ONLY: '1',
        CONFIRM_WRITES: 'true',
        KINTAI_PLUS_INCLUDE_LOCATION: 'yes',
        KINTAI_PLUS_LOG_LEVEL: 'debug',
        KINTAI_PLUS_MIN_INTERVAL_MS: '1000',
        KINTAI_PLUS_PERSIST_ENV_TOKEN: 'true',
      }),
    ).toEqual({
      refreshBeforeDays: 7,
      autoRefresh: false,
      readOnly: true,
      confirmWrites: true,
      includeLocation: true,
      logLevel: 'debug',
      minIntervalMs: 1000,
      persistEnvToken: true,
    });
  });

  it('不正な値は変数名つきのエラー', () => {
    expect(() => loadConfig({ KINTAI_PLUS_REFRESH_DAYS: 'abc' })).toThrow(
      /KINTAI_PLUS_REFRESH_DAYS/,
    );
    expect(() => loadConfig({ KINTAI_PLUS_REFRESH_DAYS: '40' })).toThrow(
      /KINTAI_PLUS_REFRESH_DAYS/,
    );
    expect(() => loadConfig({ KINTAI_PLUS_READ_ONLY: 'maybe' })).toThrow(/KINTAI_PLUS_READ_ONLY/);
    expect(() => loadConfig({ KINTAI_PLUS_LOG_LEVEL: 'loud' })).toThrow(/KINTAI_PLUS_LOG_LEVEL/);
    expect(() => loadConfig({ KINTAI_PLUS_MIN_INTERVAL_MS: '10' })).toThrow(
      /KINTAI_PLUS_MIN_INTERVAL_MS/,
    );
  });

  it('空文字は未指定として扱う', () => {
    expect(
      loadConfig({ KINTAI_PLUS_REFRESH_DAYS: '', CONFIRM_WRITES: ' ' }).refreshBeforeDays,
    ).toBe(15);
  });
});
