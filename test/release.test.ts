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
    // npm 12 は ./ 付きの bin を書き直し、「invalid and removed」と紛らわしい警告を出すので、./ なしで書く
    expect(pkg.bin['kintai-plus-mcp']).toBe('dist/cli.mjs');
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

describe('Release ワークフロー', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

  it('未処理の changeset があるときは公開しない（バージョンを上げた作業ツリーで未リリース版を公開しないため）', () => {
    expect(workflow).toMatch(
      /uses: changesets\/action@[0-9a-f]{40} # v2\.[0-9.]+\n\s+id: changesets/,
    );
    const check = workflow.slice(
      workflow.indexOf('- name: Check whether this version is published'),
    );
    expect(check.split('\n').slice(0, 3).join('\n')).toContain(
      "if: steps.changesets.outputs.has-changesets == 'false'",
    );
  });

  it('changesets/action v2 の入力名を使う（v1 の version / title / commit や GITHUB_TOKEN の env は効かない）', () => {
    const step = workflow.slice(
      workflow.indexOf('- name: Create version PR'),
      workflow.indexOf('- name: Check whether this version is published'),
    );
    expect(step).toContain('version-script: pnpm version-packages');
    expect(step).toContain('pr-title: "chore: release"');
    expect(step).toContain('commit-message: "chore: release"');
    expect(step).not.toContain('GITHUB_TOKEN');
  });

  it('npm と mcp-publisher は版を固定し、mcp-publisher はチェックサムを確かめる', () => {
    expect(workflow).toMatch(/npm install -g npm@\d+\.\d+\.\d+\b/);
    expect(workflow).not.toContain('npm@latest');
    expect(workflow).toMatch(
      /releases\/download\/v\d+\.\d+\.\d+\/mcp-publisher_linux_amd64\.tar\.gz/,
    );
    expect(workflow).not.toContain('releases/latest');
    expect(workflow).toMatch(
      /[0-9a-f]{64}\s+mcp-publisher_linux_amd64\.tar\.gz" \| sha256sum -c -/,
    );
  });

  it('公開の権限を持つので、依存のキャッシュを使わない', () => {
    const setupNode = workflow.slice(workflow.indexOf('uses: actions/setup-node@'));
    const block = setupNode.slice(0, setupNode.indexOf('- run:'));
    expect(block).not.toMatch(/^\s+cache: /m);
    expect(block).toContain('package-manager-cache: false');
  });

  it('MCP Registry に登録する前に、npm に新しい版が見えるまで待つ（直後だと Registry の検証で 404 になるため）', () => {
    const wait = workflow.indexOf('- name: Wait for the version on npm');
    const registry = workflow.indexOf('- name: Publish to MCP Registry');
    expect(wait).toBeGreaterThan(-1);
    expect(wait).toBeLessThan(registry);
    const step = workflow.slice(wait, registry);
    expect(step).toContain("if: steps.check.outputs.publish == 'true'");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions の式をそのまま探している
    expect(step).toContain('npm view "kintai-plus-mcp@${{ steps.check.outputs.version }}" version');
  });
});

describe('ワークフローのアクション', () => {
  for (const file of ['ci.yml', 'release.yml']) {
    it(`${file} のアクションはコミット SHA で固定し、版をコメントで残す`, () => {
      const uses = [
        ...readFileSync(`.github/workflows/${file}`, 'utf8').matchAll(/uses: (\S+)(.*)/g),
      ];
      expect(uses.length).toBeGreaterThan(0);
      for (const [, ref, rest] of uses) {
        expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
        expect(rest).toMatch(/^ # v\d+\.\d+\.\d+$/);
      }
    });
  }
});
