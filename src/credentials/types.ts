import * as z from 'zod/v4';
import { API_HOSTS } from '../api/endpoint.ts';

const CredentialsSchema = z.object({
  version: z.literal(1),
  host: z.enum(API_HOSTS),
  companyId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  token: z.string().min(1),
  /** トークンの有効期限（ISO 8601）。不明なら省略 */
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  staffId: z.number().int().optional(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type Credentials = z.infer<typeof CredentialsSchema>;

export type CredentialStoreKind = 'keychain' | 'file';

/** 認証情報の保存先 */
export interface CredentialStore {
  readonly kind: CredentialStoreKind;
  /** 表示用の保存場所（キーチェーンのサービス名やファイルパス） */
  readonly location: string;
  load(): Promise<Credentials | undefined>;
  save(credentials: Credentials): Promise<void>;
  /** 削除する。もともと無ければ false */
  clear(): Promise<boolean>;
}

export class CredentialsFormatError extends Error {
  override readonly name = 'CredentialsFormatError';
}

export function parseCredentials(text: string): Credentials {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CredentialsFormatError('Stored credentials are not valid JSON. Run `login` again.');
  }
  const result = CredentialsSchema.safeParse(data);
  if (!result.success) {
    // zod のメッセージは入力値を含みうるので、項目名だけを出す
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || '(root)'))];
    throw new CredentialsFormatError(
      `Stored credentials are invalid (${fields.join(', ')}). Run \`login\` again.`,
    );
  }
  return result.data;
}

export function serializeCredentials(credentials: Credentials): string {
  return JSON.stringify(CredentialsSchema.parse(credentials));
}
