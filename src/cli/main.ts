import { parseArgs } from 'node:util';
import { type Connection, isValidCompanyId, parseApiHost } from '../api/endpoint.ts';
import { KintaiApiError } from '../api/errors.ts';
import { fetchMyStaff, permissionRole, type Role, type StaffSummary } from '../api/staff.ts';
import { reissueToken } from '../api/token.ts';
import { NotLoggedInError, TokenExpiredError } from '../credentials/token-manager.ts';
import type { Credentials } from '../credentials/types.ts';
import { createRuntime, type Runtime, type RuntimeOptions } from '../runtime.ts';
import { formatIsoDateTime } from '../time/datetime.ts';
import { VERSION } from '../version.ts';

export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
  prompt(question: string): Promise<string>;
  /** 入力内容を画面に表示しない */
  promptSecret(question: string): Promise<string>;
}

export interface CliDeps {
  io: CliIO;
  runtimeOptions?: RuntimeOptions;
  startServer: (runtime: Runtime) => Promise<void>;
  now?: () => Date;
}

const USAGE = `kintai-plus-mcp ${VERSION}
非公式の マネーフォワード クラウド勤怠Plus 用 MCP サーバー

使い方:
  kintai-plus-mcp            MCP サーバーを起動する（stdio）
  kintai-plus-mcp login      企業ID・接続先・APIトークンを登録する
      --company-id <id>      ログイン企業ID
      --host <host>          接続先（atnd.ak4.jp または atnd-awj.ak4.jp）
  kintai-plus-mcp logout     保存した認証情報を削除する
  kintai-plus-mcp status     保存先・有効期限・権限を表示する
  kintai-plus-mcp --version
`;

const ROLE_LABEL: Record<Role, string> = {
  company_admin: '企業管理者',
  admin: '一般管理者',
  employee: '従業員',
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const { io } = deps;
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case undefined:
        await deps.startServer(await createRuntime(deps.runtimeOptions));
        return 0;
      case '--version':
      case '-v':
        io.stdout(`${VERSION}\n`);
        return 0;
      case '--help':
      case '-h':
      case 'help':
        io.stdout(USAGE);
        return 0;
      case 'login':
        return await login(rest, deps);
      case 'logout':
        return await logout(deps);
      case 'status':
        return await status(deps);
      default:
        io.stderr(`Unknown command: ${command}\n\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    io.stderr(`エラー: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function login(args: readonly string[], deps: CliDeps): Promise<number> {
  const { io } = deps;
  const { values } = parseArgs({
    args: [...args],
    options: { 'company-id': { type: 'string' }, host: { type: 'string' } },
    strict: true,
  });

  const companyId = (values['company-id'] ?? (await io.prompt('ログイン企業ID: '))).trim();
  if (!isValidCompanyId(companyId)) {
    io.stderr('ログイン企業ID の形式が正しくありません（英数字・ハイフン・アンダースコア）。\n');
    return 1;
  }

  const hostInput = (
    values.host ??
    (await io.prompt('接続先（ログイン後の URL のドメイン）[atnd.ak4.jp / atnd-awj.ak4.jp]: '))
  ).trim();
  const host = parseApiHost(hostInput === '' ? 'atnd.ak4.jp' : hostInput);
  if (!host) {
    io.stderr('接続先は atnd.ak4.jp か atnd-awj.ak4.jp を指定してください。\n');
    return 1;
  }

  const token = (await io.promptSecret('APIトークン（入力は表示されません）: ')).trim();
  if (token === '') {
    io.stderr('APIトークンが入力されませんでした。\n');
    return 1;
  }

  const runtime = await createRuntime(deps.runtimeOptions);
  runtime.logger.addSecret(token);
  const connection: Connection = { host, companyId };
  const client = runtime.createClient(connection, async () => token);

  let staff: StaffSummary;
  try {
    staff = await fetchMyStaff(client);
  } catch (error) {
    io.stderr(`${loginFailureMessage(error)}\n`);
    return 1;
  }

  const now = deps.now?.() ?? new Date();
  let credentials: Credentials = {
    version: 1,
    host,
    companyId,
    token,
    staffId: staff.staffId,
    updatedAt: now.toISOString(),
  };

  if (runtime.config.autoRefresh) {
    // 有効期限を確定するため、登録時に再発行する（ADR 0007）
    try {
      const reissued = await reissueToken(client, token);
      runtime.logger.addSecret(reissued.token);
      credentials = {
        ...credentials,
        token: reissued.token,
        expiresAt: reissued.expiresAt.toISOString(),
      };
    } catch (error) {
      const reason = error instanceof KintaiApiError ? error.kind : 'error';
      io.stderr(
        `トークンの再発行に失敗しました（${reason}）。入力したトークンを有効期限不明のまま保存します。\n`,
      );
    }
  }

  await runtime.store.save(credentials);
  io.stdout(
    [
      `保存しました: ${runtime.store.location}`,
      `従業員: ${staff.name ?? `ID ${staff.staffId}`}（${ROLE_LABEL[permissionRole(staff.permissionType)]}）`,
      `有効期限: ${formatExpiry(credentials.expiresAt, now)}`,
      '',
    ].join('\n'),
  );
  return 0;
}

function loginFailureMessage(error: unknown): string {
  if (error instanceof KintaiApiError) {
    if (error.kind === 'auth' || error.kind === 'forbidden' || error.kind === 'not_found') {
      return (
        `接続を確認できませんでした（${error.kind}）。次の点を確認してください:\n` +
        '- ログイン企業ID が正しいか\n' +
        '- 接続先がログイン後の URL のドメインと同じか\n' +
        '- APIトークンが有効か（マイページ > APIトークン で再発行できます）\n' +
        '- 管理者が「公開API利用可否」を「利用する」にしているか'
      );
    }
    return `接続を確認できませんでした: ${error.message}`;
  }
  return `接続を確認できませんでした: ${error instanceof Error ? error.message : String(error)}`;
}

async function logout(deps: CliDeps): Promise<number> {
  const { io } = deps;
  const runtime = await createRuntime(deps.runtimeOptions);
  const removed = await runtime.store.clear();
  io.stdout(
    removed
      ? `認証情報を削除しました: ${runtime.store.location}\n` +
          'トークン自体はまだ有効です。不要ならマイページで無効化してください。\n'
      : `保存された認証情報はありません: ${runtime.store.location}\n`,
  );
  if (deps.runtimeOptions?.env?.KINTAI_PLUS_TOKEN ?? process.env.KINTAI_PLUS_TOKEN) {
    io.stderr('注意: KINTAI_PLUS_TOKEN が設定されているため、次回の起動時に再び取り込まれます。\n');
  }
  return 0;
}

async function status(deps: CliDeps): Promise<number> {
  const { io } = deps;
  const runtime = await createRuntime(deps.runtimeOptions);
  const now = deps.now?.() ?? new Date();
  const lines = [`保存先: ${runtime.store.location}`];
  const credentials = await runtime.store.load();
  if (!credentials) {
    io.stdout(
      `${lines.join('\n')}\n未ログインです。\`npx kintai-plus-mcp login\` で登録してください。\n`,
    );
    return 1;
  }
  lines.push(
    `接続先: ${credentials.host}`,
    `ログイン企業ID: ${credentials.companyId}`,
    `従業員ID: ${credentials.staffId ?? '不明'}`,
    `有効期限: ${formatExpiry(credentials.expiresAt, now)}`,
    `自動更新: ${runtime.config.autoRefresh ? `有効（残り ${runtime.config.refreshBeforeDays} 日を切ったら再発行）` : '無効'}`,
  );

  let code = 0;
  try {
    const staff = await fetchMyStaff(await runtime.getClient());
    lines.push(`権限: ${ROLE_LABEL[permissionRole(staff.permissionType)]}`);
  } catch (error) {
    code = 1;
    if (error instanceof TokenExpiredError || error instanceof NotLoggedInError) {
      lines.push(`権限: 確認できませんでした\n${error.message}`);
    } else {
      const reason = error instanceof KintaiApiError ? error.kind : 'error';
      lines.push(`権限: 確認できませんでした（${reason}）`);
    }
  }
  io.stdout(`${lines.join('\n')}\n`);
  return code;
}

function formatExpiry(expiresAt: string | undefined, now: Date): string {
  if (!expiresAt) return '不明（次回の利用時に再発行して確定します）';
  const date = new Date(expiresAt);
  const days = Math.floor((date.getTime() - now.getTime()) / DAY_MS);
  const label = formatIsoDateTime(date).replace('T', ' ').replace('+09:00', ' (JST)');
  return days < 0 ? `${label}（期限切れ）` : `${label}（残り ${days} 日）`;
}
