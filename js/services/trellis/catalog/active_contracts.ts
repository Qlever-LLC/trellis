export type ActiveDigestServiceProfile = {
  disabled: boolean;
  appliedContracts: Array<{ allowedDigests: string[] }>;
};

/** Adds every enabled service-profile-approved contract digest to the active set. */
export function addServiceProfileAllowedDigests(
  active: Set<string>,
  profiles: Iterable<ActiveDigestServiceProfile>,
): void {
  for (const profile of profiles) {
    if (profile.disabled) continue;
    for (const applied of profile.appliedContracts) {
      for (const digest of applied.allowedDigests) {
        active.add(digest);
      }
    }
  }
}
