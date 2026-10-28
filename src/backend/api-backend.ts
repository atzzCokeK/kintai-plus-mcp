import type { KintaiApiClient } from '../api/client.ts';
import { fetchMyStaff, permissionRole } from '../api/staff.ts';
import { ALL_CAPABILITIES, type Capability, type KintaiBackend, type Profile } from './types.ts';

/** クラウド勤怠Plus 公開 API を使うバックエンド */
export class ApiBackend implements KintaiBackend {
  readonly kind = 'api' as const;
  readonly capabilities: ReadonlySet<Capability> = new Set(ALL_CAPABILITIES);
  readonly #getClient: () => Promise<KintaiApiClient>;
  #profile: Promise<Profile> | undefined;

  /** クライアントを直接、または必要になったときに作る関数で渡す（未ログインでもサーバーを起動できるように） */
  constructor(client: KintaiApiClient | (() => Promise<KintaiApiClient>)) {
    this.#getClient = typeof client === 'function' ? client : async () => client;
  }

  getMyProfile(): Promise<Profile> {
    this.#profile ??= this.#fetchProfile().catch((error: unknown) => {
      this.#profile = undefined; // 失敗は覚えない
      throw error;
    });
    return this.#profile;
  }

  async #fetchProfile(): Promise<Profile> {
    const staff = await fetchMyStaff(await this.#getClient());
    const profile: Profile = { staffId: staff.staffId, role: permissionRole(staff.permissionType) };
    if (staff.name !== undefined) profile.name = staff.name;
    if (staff.staffNum !== undefined) profile.staffNum = staff.staffNum;
    if (staff.organizationName !== undefined) profile.organizationName = staff.organizationName;
    return profile;
  }
}
