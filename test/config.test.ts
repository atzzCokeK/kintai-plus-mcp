import { describe, expect, it } from 'vitest';
import { loadConfig, resolveConfirm } from '../src/config.ts';

describe('loadConfig', () => {
  it('既定値', () => {
    expect(loadConfig({})).toEqual({
      refreshBeforeDays: 15,
      autoRefresh: true,
      readOnly: false,
      confirm: 'destructive',
      confirmSource: 'default',
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
        KINTAI_PLUS_CONFIRM: 'always',
        KINTAI_PLUS_INCLUDE_LOCATION: 'yes',
        KINTAI_PLUS_LOG_LEVEL: 'debug',
        KINTAI_PLUS_MIN_INTERVAL_MS: '1000',
        KINTAI_PLUS_PERSIST_ENV_TOKEN: 'true',
      }),
    ).toEqual({
      refreshBeforeDays: 7,
      autoRefresh: false,
      readOnly: true,
      confirm: 'always',
      confirmSource: 'env',
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
      loadConfig({ KINTAI_PLUS_REFRESH_DAYS: '', KINTAI_PLUS_CONFIRM_WRITES: ' ' })
        .refreshBeforeDays,
    ).toBe(15);
  });

  describe('確認レベル', () => {
    it('KINTAI_PLUS_CONFIRM は always / destructive / never。大文字と空白は吸収する', () => {
      expect(loadConfig({ KINTAI_PLUS_CONFIRM: 'NEVER' })).toMatchObject({
        confirm: 'never',
        confirmSource: 'env',
      });
      expect(loadConfig({ KINTAI_PLUS_CONFIRM: '  destructive  ' }).confirm).toBe('destructive');
    });

    it('保存済みより環境変数が優先される', () => {
      expect(loadConfig({ KINTAI_PLUS_CONFIRM: 'never' }).confirmSource).toBe('env');
    });

    it('旧名 CONFIRM_WRITES も当面は読む（true は毎回、false は確認しない）', () => {
      expect(loadConfig({ CONFIRM_WRITES: 'true' })).toMatchObject({
        confirm: 'always',
        confirmSource: 'env',
      });
      expect(loadConfig({ KINTAI_PLUS_CONFIRM_WRITES: 'false' }).confirm).toBe('never');
    });

    it('名前が新しい方を優先する', () => {
      expect(
        loadConfig({ KINTAI_PLUS_CONFIRM_WRITES: 'false', CONFIRM_WRITES: 'true' }).confirm,
      ).toBe('never');
      expect(
        loadConfig({ KINTAI_PLUS_CONFIRM: 'destructive', KINTAI_PLUS_CONFIRM_WRITES: 'true' })
          .confirm,
      ).toBe('destructive');
    });

    it('環境変数が無ければ保存した値、それも無ければ削除だけ', () => {
      expect(resolveConfirm({}, 'always')).toEqual({
        confirm: 'always',
        confirmSource: 'settings',
      });
      expect(resolveConfirm({}, undefined)).toEqual({
        confirm: 'destructive',
        confirmSource: 'default',
      });
      expect(resolveConfirm({ KINTAI_PLUS_CONFIRM: 'never' }, 'always')).toEqual({
        confirm: 'never',
        confirmSource: 'env',
      });
    });

    it('不正な値は、指定された変数名つきのエラー', () => {
      expect(() => loadConfig({ KINTAI_PLUS_CONFIRM: 'maybe' })).toThrow(
        /KINTAI_PLUS_CONFIRM must be one of: always, destructive, never/,
      );
      expect(() => loadConfig({ KINTAI_PLUS_CONFIRM_WRITES: 'maybe' })).toThrow(
        /KINTAI_PLUS_CONFIRM_WRITES/,
      );
      expect(() => loadConfig({ CONFIRM_WRITES: 'maybe' })).toThrow(/CONFIRM_WRITES/);
    });
  });
});
