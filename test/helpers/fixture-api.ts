import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'fixtures', 'api');
const load = (name: string): unknown => JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8'));

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

/**
 * test/fixtures/api の架空の応答を返す偽のクラウド勤怠Plus API。
 * トークンが一致しなければ 401 を返す。
 */
export function fixtureApi(options: { token: string; companyId?: string }) {
  const company = options.companyId ?? 'example-co';
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    const query = Object.fromEntries(url.searchParams);
    const token = method === 'POST' ? body?.token : query.token;
    const { token: _t, ...queryWithoutToken } = query;
    const { token: _b, ...bodyWithoutToken } = body ?? {};
    const path = url.pathname.replace('/api/cooperation', '');
    requests.push({
      method,
      path,
      query: queryWithoutToken,
      body: body ? bodyWithoutToken : undefined,
    });

    if (token !== options.token) {
      return Response.json(
        { success: false, errors: [{ code: 'AUTH', message: 'invalid token' }] },
        { status: 401 },
      );
    }
    const c = `/${company}`;
    const page = Number(query.page ?? 0);
    const route = `${method} ${path}`;
    const json = (name: string) => Response.json(load(name));
    if (route === `POST /token/reissue/${company}`) return json('token-reissue');
    if (route === `GET ${c}/staffs` && query.page === undefined) return json('staffs-me');
    if (route === `GET ${c}/staffs/1001`) return json('staffs-me');
    if (route === `GET ${c}/staffs`) {
      return page === 0
        ? json('staffs-list')
        : Response.json({ success: true, response: { staffs: [], TotalCount: 3 } });
    }
    if (route === `GET ${c}/stamps`) return json('stamps-today');
    if (route === `GET ${c}/multiple_stamps`) return json('multiple-stamps');
    if (route === `GET ${c}/working_records`) return json('working-records');
    if (route === `GET ${c}/alerts`) return json('alerts');
    if (route === `GET ${c}/projects`) {
      return page === 0
        ? json('projects')
        : Response.json({ success: true, response: { projects: [], TotalCount: 3 } });
    }
    if (route === `GET ${c}/501/tasks`) return json('tasks-501');
    if (/^GET \/[^/]+\/\d+\/tasks$/.test(route))
      return Response.json({ success: true, response: { tasks: [] } });
    if (route === `GET ${c}/staff_projects/1001`) return json('staff-projects');
    if (route === `GET ${c}/project_staffs/501`) return json('project-staffs');
    if (route === `GET ${c}/manhours`) return json('manhours');
    if (route === 'POST /working_statuses/search') return json('working-statuses');
    if (route === `POST ${c}/stamps`) {
      return Response.json({
        success: true,
        response: { staff_id: 1001, type: body?.type, stamped_at: body?.stampedAt },
      });
    }
    if (route === `POST ${c}/manhours` || route === `DELETE ${c}/manhours/1001`)
      return json('ok-empty');
    return Response.json(
      { success: false, errors: [{ code: 'NOT_FOUND', message: route }] },
      { status: 404 },
    );
  };
  return { fetch: fetchImpl, requests };
}
