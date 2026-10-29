/**
 * 実環境を叩く手動 E2E（読み取りのみ）。CI では実行しない（CLAUDE.md）。
 *
 *   node e2e/smoke.ts            # 保存済みの認証情報で、読み取り系の API を一通り呼ぶ
 *   node e2e/smoke.ts --record   # 応答を e2e/.local/responses/ に保存する（トークンは伏せる。個人情報は残るので共有しない）
 *
 * 画面には件数と成否だけを出す（個人情報を出さない）。記録した応答をフィクスチャにするときは
 * `node e2e/anonymize.ts <file>` で匿名化し、目で確認してから test/fixtures/api/ に置く。
 * 自動更新が有効なら、期限が近いトークンはこの実行中に再発行されることがある。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RecordedResponse } from '../src/api/client.ts';
import { API_CODE, hasErrorCode } from '../src/api/errors.ts';
import { isAdminRole } from '../src/api/staff.ts';
import { ApiBackend } from '../src/backend/api-backend.ts';
import { createRuntime } from '../src/runtime.ts';
import { addDays, startOfMonth, todayInTokyo } from '../src/time/datetime.ts';

const record = process.argv.includes('--record');
const outDir = join(import.meta.dirname, '.local', 'responses');
let seq = 0;
const pending: Promise<void>[] = [];

async function save(response: RecordedResponse): Promise<void> {
  const { pathname } = new URL(response.url);
  const name = `${String(++seq).padStart(3, '0')}-${response.method}-${pathname
    .replace('/api/cooperation/', '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')}.json`;
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  await writeFile(join(outDir, name), `${response.body}\n`, { mode: 0o600 });
}

const runtime = await createRuntime(
  record ? { onResponse: (r) => void pending.push(save(r)) } : {},
);
const backend = new ApiBackend(() => runtime.getClient(), {
  knownStaffId: async () => (await runtime.tokens.getCredentials()).staffId,
});

const today = todayInTokyo();
const results: Array<[string, string]> = [];
async function step(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    results.push([name, `ok  ${await fn()}`]);
  } catch (error) {
    // 見えるプロジェクトが 0 件だと 404 ERR301900。一覧系は空として成功させる。
    if (hasErrorCode(error, API_CODE.noProjects)) {
      results.push([name, 'ok  0 (no visible projects)']);
      return;
    }
    const kind =
      (error as { kind?: string }).kind ?? (error instanceof Error ? error.name : 'error');
    results.push([name, `NG  ${kind}: ${error instanceof Error ? error.message : String(error)}`]);
  }
}

let profile: Awaited<ReturnType<typeof backend.getMyProfile>> | undefined;
try {
  await runtime.tokens.getCredentials();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
await step('profile', async () => {
  profile = await backend.getMyProfile();
  return `role=${profile.role}`;
});
await step(
  'stamps (today)',
  async () => `${(await backend.getStamps({ from: today, to: today })).stamps.length} stamps`,
);
await step('stamps (7 days)', async () => {
  const r = await backend.getStamps({ from: addDays(today, -6), to: today });
  return `${r.stamps.length} stamps${r.truncated ? ' (truncated)' : ''}`;
});
await step(
  'working records (this month)',
  async () =>
    `${(await backend.getWorkingRecords({ from: startOfMonth(today), to: today })).length} days`,
);
await step('alerts', async () => `${(await backend.getAlerts()).length} alerts`);
let firstProject: number | undefined;
await step('projects', async () => {
  const r = await backend.listProjects();
  firstProject = r.projects[0]?.projectId;
  return `${r.projects.length} projects${r.truncated ? ' (truncated)' : ''}`;
});
await step('my projects', async () => `${(await backend.getMyProjectIds()).length} projects`);
if (firstProject !== undefined) {
  const id = firstProject;
  await step(
    'tasks (first project)',
    async () => `${(await backend.listTasks(id)).tasks.length} tasks`,
  );
}
await step(
  'manhours (this month)',
  async () =>
    `${(await backend.getManhours({ from: startOfMonth(today), to: today })).length} days`,
);

if (profile && isAdminRole(profile.role)) {
  let ids: number[] = [];
  await step('staff', async () => {
    const r = await backend.listStaff();
    ids = r.staff.slice(0, 5).map((s) => s.staffId);
    return `${r.staff.length} staff (total ${r.totalCount ?? '?'})${r.truncated ? ' (truncated)' : ''}`;
  });
  if (ids.length > 0) {
    await step(
      'team stamps (today, up to 5)',
      async () => `${(await backend.getTeamStamps(today, ids)).stamps.length} stamps`,
    );
    await step(
      'working statuses (today, up to 5)',
      async () =>
        `${(await backend.getWorkingStatuses(ids.map((staffId) => ({ staffId, date: today })))).length} entries`,
    );
  }
  if (firstProject !== undefined) {
    const id = firstProject;
    await step(
      'project members (first project)',
      async () => `${(await backend.getProjectMembers(id)).staffIds.length} members`,
    );
  }
}

await Promise.all(pending);
for (const [name, result] of results) process.stderr.write(`${name.padEnd(36)} ${result}\n`);
if (record)
  process.stderr.write(
    `\nResponses saved to ${outDir} (raw; contains personal data — do not share)\n`,
  );
process.exitCode = results.some(([, r]) => r.startsWith('NG')) ? 1 : 0;
