export type GroupMappingConfig = {
  auth: {
    groupMappings?: {
      providers: Record<string, Record<string, string[]>>;
    };
  };
};

/** The result of mapping external identity-provider groups to Trellis groups. */
export type GroupMappingResult = {
  capabilityGroups: string[];
  unmappedGroups: string[];
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Maps normalized provider groups to Trellis capability groups deterministically. */
export function mapProviderGroups(
  config: GroupMappingConfig,
  provider: string,
  groups: readonly string[] | undefined,
): GroupMappingResult {
  const mappings = config.auth.groupMappings?.providers[provider] ?? {};
  const normalizedMappings = new Map(
    Object.entries(mappings).map(([group, capabilityGroups]) => [
      normalize(group),
      capabilityGroups,
    ]),
  );
  const normalizedGroups = [
    ...new Set(
      (groups ?? []).map(normalize).filter((group) => group.length > 0),
    ),
  ];
  const capabilityGroups = new Set<string>();
  const unmappedGroups: string[] = [];
  for (const group of normalizedGroups) {
    const mapped = normalizedMappings.get(group);
    if (!mapped) {
      unmappedGroups.push(group);
      continue;
    }
    for (const capabilityGroup of mapped) capabilityGroups.add(capabilityGroup);
  }
  return {
    capabilityGroups: [...capabilityGroups].sort(),
    unmappedGroups: unmappedGroups.sort(),
  };
}

/** Replaces memberships controlled by this provider while retaining manual groups. */
export function applyProviderGroupMapping(
  config: GroupMappingConfig,
  provider: string,
  existing: readonly string[],
  mapped: readonly string[],
): string[] {
  const controlled = new Set(
    Object.values(config.auth.groupMappings?.providers[provider] ?? {}).flat(),
  );
  return [
    ...new Set([
      ...existing.filter((group) => !controlled.has(group)),
      ...mapped,
    ]),
  ].sort();
}
