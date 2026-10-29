import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliDeps, runCli } from '../../src/cli/main.ts';
import { VERSION } from '../../src/version.ts';

const TOKEN = 'pasted-token-abcdef';
const NEW_TOKEN = 'reissued-token-123456';
const NOW = new Date('2026-10-27T00:00:00Z');

let dir: string;
let credentialsFile: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kintai-plus-mcp-cli-'));
  credentialsFile = join(dir, 'credentials.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Harness {
  deps: CliDeps;
  out: string[];
  err: string[];
  answers: string[];
  requests: string[];
  served: number;
}

function harness(
  options: { answers?: string[]; fetch?: typeof fetch; env?: Record<string, string> } = {},
): Harness {
  const h: Harness = {
    out: [],
    err: [],
    answers: [...(options.answers ?? [])],
    requests: [],
    served: 0,
    deps: undefined as never,
  };
  const defaultFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    h.requests.push(`${init?.method} ${url.pathname}`);
    if (url.pathname.includes('/token/reissue/')) {
      return Response.json({
        success: true,
        response: { token: NEW_TOKEN, expired_at: '2026/11/28 09:00:00', staff_id: 7 },
      });
    }
    return Response.json({
      success: true,
      response: {
        staffId: 7,
        lastName: '山田',
        firstName: '花子',
        permissionGroup: { permissionType: 2 },
      },
    });
  };
  h.deps = {
    io: {
      stdout: (s) => h.out.push(s),
      stderr: (s) => h.err.push(s),
      prompt: async () => h.answers.shift() ?? '',
      promptSecret: async () => h.answers.shift() ?? '',
    },
    runtimeOptions: {
      env: {
        KINTAI_PLUS_CREDENTIALS_FILE: credentialsFile,
        KINTAI_PLUS_MIN_INTERVAL_MS: '100',
        ...options.env,
      },
      fetch: options.fetch ?? defaultFetch,
      now: () => NOW,
      writeLog: (s) => h.err.push(s),
    },
    startServer: async () => {
      h.served++;
    },
    now: () => NOW,
  };
  return h;
}

const allOutput = (h: Harness) => [...h.out, ...h.err].join('');

describe('runCli', () => {
  it('引数なしなら MCP サーバーを起動する', async () => {
    const h = harness();
    expect(await runCli([], h.deps)).toBe(0);
    expect(h.served).toBe(1);
    expect(h.out).toEqual([]); // stdout は MCP の通信路
  });

  it('--version / --help', async () => {
    const h = harness();
    expect(await runCli(['--version'], h.deps)).toBe(0);
    expect(h.out.join('')).toContain(VERSION);
    expect(await runCli(['--help'], h.deps)).toBe(0);
    expect(h.out.join('')).toMatch(/login/);
  });

  it('不明なコマンドは使い方を出して 2', async () => {
    const h = harness();
    expect(await runCli(['punch'], h.deps)).toBe(2);
    expect(h.err.join('')).toMatch(/Unknown command/);
  });

  describe('login', () => {
    it('対話入力 → 疎通確認 → 再発行 → 保存。トークンは画面に出さない', async () => {
      const h = harness({ answers: ['acme', 'https://atnd-awj.ak4.jp/', TOKEN] });
      expect(await runCli(['login'], h.deps)).toBe(0);
      const saved = JSON.parse(await readFile(credentialsFile, 'utf8'));
      expect(saved).toMatchObject({
        host: 'atnd-awj.ak4.jp',
        companyId: 'acme',
        token: NEW_TOKEN,
        staffId: 7,
        expiresAt: '2026-11-28T00:00:00.000Z',
      });
      expect(h.requests).toEqual([
        'GET /api/cooperation/acme/staffs',
        'POST /api/cooperation/token/reissue/acme',
      ]);
      const output = allOutput(h);
      expect(output).toContain('山田 花子');
      expect(output).toContain('一般管理者');
      expect(output).toContain('2026-11-28');
      expect(output).not.toContain(TOKEN);
      expect(output).not.toContain(NEW_TOKEN);
    });

    it('フラグで企業 ID・接続先を渡せる', async () => {
      const h = harness({ answers: [TOKEN] });
      expect(await runCli(['login', '--company-id', 'acme', '--host', 'atnd.ak4.jp'], h.deps)).toBe(
        0,
      );
      const saved = JSON.parse(await readFile(credentialsFile, 'utf8'));
      expect(saved).toMatchObject({ companyId: 'acme', host: 'atnd.ak4.jp' });
    });

    it('接続先を空で入力したら atnd.ak4.jp', async () => {
      const h = harness({ answers: ['acme', '', TOKEN] });
      expect(await runCli(['login'], h.deps)).toBe(0);
      const saved = JSON.parse(await readFile(credentialsFile, 'utf8'));
      expect(saved.host).toBe('atnd.ak4.jp');
    });

    it('無効なトークン（404 ERR300002）は再発行を案内する', async () => {
      const h = harness({
        answers: ['acme', '', TOKEN],
        fetch: async () =>
          Response.json(
            {
              success: false,
              errors: [{ code: 'ERR300002', message: '指定されたトークンは無効です。' }],
            },
            { status: 404 },
          ),
      });
      expect(await runCli(['login'], h.deps)).toBe(1);
      expect(h.err.join('')).toMatch(/再発行/);
      expect(allOutput(h)).not.toContain(TOKEN);
    });

    it('存在しない企業 ID（404 ERR300001）は企業 ID の確認を案内する', async () => {
      const h = harness({
        answers: ['acme', '', TOKEN],
        fetch: async () =>
          Response.json(
            {
              success: false,
              errors: [{ code: 'ERR300001', message: '指定された企業は存在しません。' }],
            },
            { status: 404 },
          ),
      });
      expect(await runCli(['login'], h.deps)).toBe(1);
      expect(h.err.join('')).toMatch(/ログイン企業ID/);
      expect(h.err.join('')).not.toMatch(/再発行/);
    });

    it('疎通確認で認証エラーなら保存せず、確認すべき点を案内する', async () => {
      const h = harness({
        answers: ['acme', '', TOKEN],
        fetch: async () =>
          Response.json(
            { success: false, errors: [{ code: 'E', message: 'invalid' }] },
            { status: 401 },
          ),
      });
      expect(await runCli(['login'], h.deps)).toBe(1);
      await expect(readFile(credentialsFile)).rejects.toThrow();
      expect(h.err.join('')).toMatch(/企業ID|接続先|トークン/);
      expect(allOutput(h)).not.toContain(TOKEN);
    });

    it('保存ファイルが壊れていても login で上書きできる', async () => {
      await writeFile(credentialsFile, '{broken', { mode: 0o600 });
      const h = harness({ answers: ['acme', '', TOKEN] });
      expect(await runCli(['login'], h.deps)).toBe(0);
      expect(JSON.parse(await readFile(credentialsFile, 'utf8')).companyId).toBe('acme');
    });

    it('不正な企業 ID・接続先・空のトークンは弾く', async () => {
      expect(await runCli(['login'], harness({ answers: ['a/b'] }).deps)).toBe(1);
      expect(await runCli(['login'], harness({ answers: ['acme', 'evil.example.com'] }).deps)).toBe(
        1,
      );
      expect(await runCli(['login'], harness({ answers: ['acme', '', ''] }).deps)).toBe(1);
    });

    it('再発行に失敗しても、確認できたトークンは期限不明として保存する', async () => {
      const h = harness({
        answers: ['acme', '', TOKEN],
        fetch: async (input) =>
          String(input).includes('reissue')
            ? Response.json({ success: false, errors: [] }, { status: 503 })
            : Response.json({ success: true, response: { staffId: 7 } }),
      });
      expect(await runCli(['login'], h.deps)).toBe(0);
      const saved = JSON.parse(await readFile(credentialsFile, 'utf8'));
      expect(saved.token).toBe(TOKEN);
      expect(saved.expiresAt).toBeUndefined();
    });
  });

  describe('status', () => {
    it('未ログインなら案内して 1', async () => {
      const h = harness();
      expect(await runCli(['status'], h.deps)).toBe(1);
      expect(allOutput(h)).toMatch(/login/);
    });

    it('保存先・接続先・有効期限・権限を表示し、トークンは表示しない', async () => {
      await writeFile(
        credentialsFile,
        JSON.stringify({
          version: 1,
          host: 'atnd.ak4.jp',
          companyId: 'acme',
          token: TOKEN,
          expiresAt: '2026-11-20T00:00:00.000Z',
          staffId: 7,
          updatedAt: '2026-10-20T00:00:00.000Z',
        }),
        { mode: 0o600 },
      );
      const h = harness();
      expect(await runCli(['status'], h.deps)).toBe(0);
      const out = h.out.join('');
      expect(out).toContain(credentialsFile);
      expect(out).toContain('atnd.ak4.jp');
      expect(out).toContain('acme');
      expect(out).toContain('2026-11-20');
      expect(out).toMatch(/残り 24 日/);
      expect(out).toContain('一般管理者');
      expect(allOutput(h)).not.toContain(TOKEN);
    });
  });

  describe('logout', () => {
    it('保存した認証情報を削除する', async () => {
      await writeFile(
        credentialsFile,
        JSON.stringify({
          version: 1,
          host: 'atnd.ak4.jp',
          companyId: 'acme',
          token: TOKEN,
          updatedAt: '2026-10-20T00:00:00.000Z',
        }),
        { mode: 0o600 },
      );
      const h = harness();
      expect(await runCli(['logout'], h.deps)).toBe(0);
      await expect(readFile(credentialsFile)).rejects.toThrow();
      expect(h.out.join('')).toMatch(/削除/);
    });

    it('何もなくても成功し、その旨を表示する', async () => {
      const h = harness();
      expect(await runCli(['logout'], h.deps)).toBe(0);
      expect(h.out.join('')).toMatch(/ありません/);
    });
  });
});
