import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { syncServerJson } from '../scripts/sync-server-json.ts';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const server = JSON.parse(readFileSync('server.json', 'utf8'));

describe('server.json（MCP Registry）', () => {
  it('名前とバージョンが package.json と一致する', () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0].identifier).toBe(pkg.name);
    expect(server.packages[0].version).toBe(pkg.version);
  });

  it('stdio の npm パッケージとして申告し、説明は 100 文字以内', () => {
    expect(server.packages[0]).toMatchObject({ registryType: 'npm', transport: { type: 'stdio' } });
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it('トークンの環境変数は secret として申告する', () => {
    const token = server.packages[0].environmentVariables.find(
      (e: { name: string }) => e.name === 'KINTAI_PLUS_TOKEN',
    );
    expect(token).toMatchObject({ isSecret: true, isRequired: false });
  });
});

describe('package.json', () => {
  it('公開設定: provenance 付き・public', () => {
    expect(pkg.publishConfig).toMatchObject({ access: 'public', provenance: true });
    expect(pkg.bin['kintai-plus-mcp']).toBe('./dist/cli.mjs');
    expect(pkg.files).toEqual(['dist']);
  });
});

describe('syncServerJson', () => {
  it('package.json のバージョンを server.json に反映する（他は変えない）', () => {
    const out = syncServerJson(
      {
        name: 'x',
        version: '0.0.0',
        packages: [{ identifier: 'kintai-plus-mcp', version: '0.0.0', extra: 1 }],
      },
      { version: '0.2.0' },
    );
    expect(out).toEqual({
      name: 'x',
      version: '0.2.0',
      packages: [{ identifier: 'kintai-plus-mcp', version: '0.2.0', extra: 1 }],
    });
  });
});
