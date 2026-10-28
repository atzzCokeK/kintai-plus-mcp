import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.ts';

describe('version', () => {
  it('package.json の version と一致する', async () => {
    const pkg = await import('../package.json', { with: { type: 'json' } });
    expect(VERSION).toBe(pkg.default.version);
  });
});
