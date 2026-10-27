import { KintaiApiError } from '../api/errors.ts';
import { LimitExceededError } from '../api/paging.ts';
import { redactSecrets } from '../api/redact.ts';
import { NotLoggedInError, TokenExpiredError } from '../credentials/token-manager.ts';

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: true;
}

/** 入力の誤りなど、AI が入力を直して再実行できる失敗 */
export class ToolInputError extends Error {
  override readonly name = 'ToolInputError';
}

/** 安全策で実行を止めた（打刻の矛盾など）。hint に回避方法を書く */
export class ToolRefusedError extends Error {
  override readonly name = 'ToolRefusedError';
  readonly hint: string;
  readonly details: unknown;
  constructor(message: string, hint: string, details?: unknown) {
    super(message);
    this.hint = hint;
    this.details = details;
  }
}

export function successResult(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

export function errorResult(error: unknown): ToolResult {
  const [message, hint] = describeError(error);
  const body = hint ? `${message}\nHint: ${hint}` : message;
  return { isError: true, content: [{ type: 'text', text: redactSecrets(body) }] };
}

function describeError(error: unknown): [string, string?] {
  if (error instanceof NotLoggedInError || error instanceof TokenExpiredError) {
    return [error.message];
  }
  if (error instanceof ToolInputError) return [error.message, 'Fix the input and try again.'];
  if (error instanceof ToolRefusedError) {
    const details =
      error.details === undefined ? '' : `\nDetails: ${JSON.stringify(error.details)}`;
    return [`${error.message}${details}`, error.hint];
  }
  if (error instanceof LimitExceededError) {
    return [error.message, 'Use a shorter period or narrow down the target, then try again.'];
  }
  if (error instanceof RangeError) return [error.message, 'Fix the input and try again.'];
  if (error instanceof KintaiApiError) return [error.message, apiHint(error)];
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return [`Unexpected error: ${message}`];
}

function apiHint(error: KintaiApiError): string {
  switch (error.kind) {
    case 'auth':
      return 'The API token may have expired or been revoked. Ask the user to issue a new token from マイページ > APIトークン and run `npx kintai-plus-mcp login`.';
    case 'forbidden':
      return 'Kintai Plus denied this operation. The user may not have permission for it (admin rights may be required), or the public API (公開API利用可否) may be disabled for this user.';
    case 'not_found':
      return 'The requested item was not found. Check the IDs (staff, project, task) and the date.';
    case 'invalid_request':
      return 'Kintai Plus rejected the request. Check the parameters (dates, IDs, period length).';
    case 'rate_limited':
      return 'Too many requests. Wait a minute before trying again.';
    case 'server':
    case 'network':
    case 'timeout':
      return 'Kintai Plus could not be reached or had a temporary problem. Retry later.';
    case 'invalid_response':
      return 'Kintai Plus returned an unexpected response. Retry later; if it persists, report it as a bug.';
  }
}
