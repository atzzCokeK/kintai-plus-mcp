import type { KintaiApiClient } from '../api/client.ts';
import { fetchMyStaff, permissionRole } from '../api/staff.ts';
import { ALL_CAPABILITIES, type Capability, type KintaiBackend, type Profile } from './types.ts';

/** クラウド勤怠Plus 公開 API を使うバックエンド */
export class ApiBackend implements KintaiBackend {
  readonly kind = 'api' as const;
  readonly capabilities: ReadonlySet<Capability> = new Set(ALL_CAPABILITIES);
  readonly #client: KintaiApiClient;
  #profile: Promise<Profile> | undefined;

  constructor(client: KintaiApiClient) {
    this.#client = client;
  }

  getMyProfile(): Promise<Profile> {
    this.#profile ??= this.#fetchProfile().catch((error: unknown) => {
      this.#profile = undefined; // 失敗は覚えない
      throw error;
    });
    return this.#profile;
  }

  async #fetchProfile(): Promise<Profile> {
    const staff = await fetchMyStaff(this.#client);
    const profile: Profile = { staffId: staff.staffId, role: permissionRole(staff.permissionType) };
    if (staff.name !== undefined) profile.name = staff.name;
    if (staff.staffNum !== undefined) profile.staffNum = staff.staffNum;
    if (staff.organizationName !== undefined) profile.organizationName = staff.organizationName;
    return profile;
  }
}
