import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      // いまの計測より約 2 ポイント下。少し枝が増えても落ちず、大きく薄くなると落ちる。
      thresholds: {
        lines: 95,
        statements: 93,
        functions: 93,
        branches: 84,
      },
    },
  },
});
