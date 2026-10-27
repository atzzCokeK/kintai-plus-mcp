import { parseApiDateTime } from '../time/datetime.ts';
import type { KintaiApiClient } from './client.ts';
import { COMPANY_ID } from './endpoint.ts';
import { KintaiApiError } from './errors.ts';

export interface ReissuedToken {
  token: string;
  expiresAt: Date;
  staffId: number | undefined;
}

interface ReissueResponse {
  login_company_code?: string | null;
  staff_id?: number | null;
  token?: string | null;
  expired_at?: string | null;
}

/** トークン再発行 API（`POST /token/reissue/{companyId}`）。有効期限は 1 ヶ月と 1 日。 */
export async function reissueToken(
  client: KintaiApiClient,
  currentToken: string,
): Promise<ReissuedToken> {
  const res = await client.post<ReissueResponse | null>(
    ['token', 'reissue', COMPANY_ID],
    {},
    { token: currentToken },
  );
  const token = res?.token;
  const expiresAt = parseApiDateTime(res?.expired_at);
  if (!token || !expiresAt) {
    throw new KintaiApiError({
      kind: 'invalid_response',
      message: 'Token reissue response did not include a token and expiry',
    });
  }
  return { token, expiresAt, staffId: res?.staff_id ?? undefined };
}
