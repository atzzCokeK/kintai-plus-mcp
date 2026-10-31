import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatInteractiveHostPrompt } from '../../src/cli/host-prompt.ts';
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
  prompts: string[];
  answers: string[];
  requests: string[];
  served: number;
}

function harness(
  options: {
    answers?: string[];
    fetch?: typeof fetch;
    env?: Record<string, string>;
    /** 省略時は非 TTY（ホスト名の 1 行入力） */
    interactive?: boolean;
  } = {},
): Harness {
  const h: Harness = {
    out: [],
    err: [],
    prompts: [],
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
      prompt: async (question) => {
        h.prompts.push(question);
        return h.answers.shift() ?? '';
      },
      promptSecret: async () => h.answers.shift() ?? '',
      interactive: options.interactive ?? false,
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

    it('非 TTY ではホスト名の 1 行のまま。空なら atnd.ak4.jp', async () => {
      const h = harness({ interactive: false, answers: ['acme', '', TOKEN] });
      expect(await runCli(['login'], h.deps)).toBe(0);
      const saved = JSON.parse(await readFile(credentialsFile, 'utf8'));
      expect(saved.host).toBe('atnd.ak4.jp');
      expect(h.prompts[1]).toBe(
        '接続先（ログイン後の URL のドメイン）[atnd.ak4.jp / atnd-awj.ak4.jp]: ',
      );
      expect(h.prompts.join('\n')).not.toContain('番号');
    });

    it('非 TTY では番号を選ばない（1 は接続先にならない）', async () => {
      const h = harness({ interactive: false, answers: ['acme', '1'] });
      expect(await runCli(['login'], h.deps)).toBe(1);
      expect(h.err.join('')).toContain(
        '接続先は atnd.ak4.jp か atnd-awj.ak4.jp を指定してください。',
      );
    });

    it('対話端末では番号で接続先を選ぶ。空 Enter は atnd.ak4.jp', async () => {
      const h = harness({ interactive: true, answers: ['acme', '', TOKEN] });
      expect(await runCli(['login'], h.deps)).toBe(0);
      const saved = JSON.parse(await readFile(credentialsFile, 'utf8'));
      expect(saved.host).toBe('atnd.ak4.jp');
      expect(h.prompts[1]).toBe(formatInteractiveHostPrompt());
    });

    it('対話端末で 2 を選ぶと atnd-awj.ak4.jp', async () => {
      const h = harness({ interactive: true, answers: ['acme', '2', TOKEN] });
      expect(await runCli(['login'], h.deps)).toBe(0);
      const saved = JSON.parse(await readFile(credentialsFile, 'utf8'));
      expect(saved.host).toBe('atnd-awj.ak4.jp');
    });

    it('対話端末で 1 を選ぶと atnd.ak4.jp。URL を貼っても既知の接続先なら受け付ける', async () => {
      const byNumber = harness({ interactive: true, answers: ['acme', '1', TOKEN] });
      expect(await runCli(['login'], byNumber.deps)).toBe(0);
      expect(JSON.parse(await readFile(credentialsFile, 'utf8')).host).toBe('atnd.ak4.jp');

      const byUrl = harness({
        interactive: true,
        answers: ['acme', 'https://atnd-awj.ak4.jp/login', TOKEN],
      });
      expect(await runCli(['login'], byUrl.deps)).toBe(0);
      expect(JSON.parse(await readFile(credentialsFile, 'utf8')).host).toBe('atnd-awj.ak4.jp');
    });

    it('対話端末で一覧に無い入力は番号の案内で弾く', async () => {
      const h = harness({ interactive: true, answers: ['acme', '9'] });
      expect(await runCli(['login'], h.deps)).toBe(1);
      await expect(readFile(credentialsFile)).rejects.toThrow();
      expect(h.err.join('')).toMatch(/番号で選んでください/);
      expect(h.err.join('')).toContain('atnd.ak4.jp');
      expect(h.err.join('')).toContain('atnd-awj.ak4.jp');
    });

    it('対話中でも --host を渡せば接続先を聞かない', async () => {
      const h = harness({ interactive: true, answers: [TOKEN] });
      expect(
        await runCli(['login', '--company-id', 'acme', '--host', 'atnd-awj.ak4.jp'], h.deps),
      ).toBe(0);
      expect(h.prompts.join('\n')).not.toMatch(/接続先|番号/);
      expect(JSON.parse(await readFile(credentialsFile, 'utf8')).host).toBe('atnd-awj.ak4.jp');
    });

    it('--host が不正なら、対話端末でも番号ではなく接続先の案内', async () => {
      const h = harness({ interactive: true });
      expect(
        await runCli(['login', '--company-id', 'acme', '--host', 'evil.example.com'], h.deps),
      ).toBe(1);
      expect(h.prompts).toEqual([]);
      expect(h.err.join('')).toContain(
        '接続先は atnd.ak4.jp か atnd-awj.ak4.jp を指定してください。',
      );
      expect(h.err.join('')).not.toContain('番号で選んでください');
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

    it('環境変数のトークンは保存せず再発行せず、status で使えると示す', async () => {
      const h = harness({
        env: { KINTAI_PLUS_TOKEN: TOKEN, KINTAI_PLUS_COMPANY_ID: 'acme' },
      });
      expect(await runCli(['status'], h.deps)).toBe(0);
      expect(h.requests.some((r) => r.includes('reissue'))).toBe(false);
      await expect(readFile(credentialsFile, 'utf8')).rejects.toThrow();
      expect(h.out.join('')).toMatch(/環境変数/);
      expect(h.out.join('')).toMatch(/再発行しません/);
      expect(allOutput(h)).not.toContain(TOKEN);
    });

    it('環境変数がある logout は、次回もそのトークンを使うが保存はしないと注意する', async () => {
      const h = harness({
        env: { KINTAI_PLUS_TOKEN: TOKEN, KINTAI_PLUS_COMPANY_ID: 'acme' },
      });
      expect(await runCli(['logout'], h.deps)).toBe(0);
      expect(h.err.join('')).toMatch(/環境変数/);
      expect(h.err.join('')).toMatch(/保存しません/);
      expect(allOutput(h)).not.toContain(TOKEN);
    });

    it('何もなくても成功し、その旨を表示する', async () => {
      const h = harness();
      expect(await runCli(['logout'], h.deps)).toBe(0);
      expect(h.out.join('')).toMatch(/ありません/);
    });
  });
});
