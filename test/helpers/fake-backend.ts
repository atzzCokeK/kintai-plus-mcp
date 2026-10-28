import { ALL_CAPABILITIES, type KintaiBackend } from '../../src/backend/types.ts';
import { loadConfig } from '../../src/config.ts';
import { silentLogger } from '../../src/log.ts';
import type { ToolContext } from '../../src/tools/registry.ts';

/** 必要なメソッドだけ差し替えた偽のバックエンド。未実装のメソッドを呼ぶと失敗する */
export function fakeBackend(overrides: Partial<KintaiBackend> = {}): KintaiBackend {
  const base = {
    kind: 'api' as const,
    capabilities: new Set(ALL_CAPABILITIES),
    getMyProfile: async () => ({ staffId: 1, name: 'テスト 太郎', role: 'employee' as const }),
  };
  return new Proxy({ ...base, ...overrides } as KintaiBackend, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (typeof prop === 'string' && prop !== 'then') {
        return async () => {
          throw new Error(`fakeBackend.${prop} is not stubbed`);
        };
      }
      return undefined;
    },
  });
}

export function fakeContext(
  backend: KintaiBackend = fakeBackend(),
  env: Record<string, string> = {},
  now = new Date('2026-10-27T01:00:00Z'),
): ToolContext {
  return { backend, config: loadConfig(env), logger: silentLogger, now: () => now };
}
