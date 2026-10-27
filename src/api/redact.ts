/**
 * トークンをログ・エラーメッセージから取り除く。
 * GET ではトークンが URL のクエリに載る API 仕様のため、外に出す文字列は必ずここを通す。
 */
export const REDACTED = '[REDACTED]';

/** 置換に使う秘密情報の最短長。短すぎる値で関係ない文字列を潰さないため。 */
const MIN_SECRET_LENGTH = 6;

const TOKEN_PARAM = /([?&]token=)[^&#\s"'<>]*/gi;
const TOKEN_JSON = /(["']?token["']?\s*:\s*["'])[^"']*(["'])/gi;

export function redactUrl(url: URL | string): string {
  const parsed = typeof url === 'string' ? safeParseUrl(url) : new URL(url.toString());
  if (!parsed) return redactSecrets(String(url));
  if (parsed.searchParams.has('token')) parsed.searchParams.set('token', REDACTED);
  // URLSearchParams は [] をエンコードするので、見やすいように戻す
  return parsed.toString().replace(encodeURIComponent(REDACTED), REDACTED);
}

export function redactSecrets(text: string, secrets: readonly (string | undefined)[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < MIN_SECRET_LENGTH) continue;
    for (const variant of new Set([secret, encodeURIComponent(secret), formEncode(secret)])) {
      out = out.split(variant).join(REDACTED);
    }
  }
  out = out.replace(TOKEN_PARAM, `$1${REDACTED}`);
  out = out.replace(TOKEN_JSON, `$1${REDACTED}$2`);
  return out;
}

function formEncode(value: string): string {
  return new URLSearchParams({ v: value }).toString().slice(2);
}

function safeParseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
