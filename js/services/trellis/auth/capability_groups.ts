import type { CapabilityGroup } from "./schemas.ts";

export const BUILTIN_ADMIN_CAPABILITIES = [
  "admin",
  "trellis.auth::device.review",
  "trellis.auth::events.auth",
  "trellis.jobs::admin.read",
  "trellis.jobs::admin.mutate",
  "trellis.jobs::admin.stream",
  "trellis.core::catalog.read",
  "trellis.core::contract.read",
] as const;

export const BUILTIN_ADMIN_GROUP: CapabilityGroup = {
  groupKey: "admin",
  displayName: "Trellis Admin",
  description: "Grants Trellis platform administration capabilities.",
  capabilities: [...BUILTIN_ADMIN_CAPABILITIES],
  includedGroups: [],
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
};

export type CapabilityGroupLoader = {
  get(groupKey: string): Promise<CapabilityGroup | undefined>;
};

export type CapabilityGroupListStorage = {
  listPage(
    query: { offset?: number; limit: number },
  ): Promise<CapabilityGroup[]>;
};

export type CapabilityGrantInput = {
  capabilities: string[];
  capabilityGroups?: string[];
};

export type ActiveCapabilityGrantInput = CapabilityGrantInput & {
  active: boolean;
};

const BUILTIN_GROUPS = new Map<string, CapabilityGroup>([
  [BUILTIN_ADMIN_GROUP.groupKey, BUILTIN_ADMIN_GROUP],
]);

async function loadGroup(
  groupKey: string,
  storage?: CapabilityGroupLoader,
): Promise<CapabilityGroup | undefined> {
  return BUILTIN_GROUPS.get(groupKey) ?? await storage?.get(groupKey);
}

/** Resolves direct capabilities and assigned groups into concrete capabilities. */
export async function resolveCapabilities(
  input: CapabilityGrantInput,
  storage?: CapabilityGroupLoader,
): Promise<string[]> {
  const resolved = new Set(input.capabilities);
  const pending = new Set(input.capabilityGroups ?? []);
  if (resolved.has("admin")) pending.add("admin");
  const visiting = new Set<string>();
  const visited = new Set<string>();

  async function visit(groupKey: string): Promise<void> {
    if (visited.has(groupKey) || visiting.has(groupKey)) return;
    visiting.add(groupKey);
    const group = await loadGroup(groupKey, storage);
    if (group) {
      for (const capability of group.capabilities) resolved.add(capability);
      for (const included of group.includedGroups) await visit(included);
    }
    visiting.delete(groupKey);
    visited.add(groupKey);
  }

  for (const groupKey of pending) await visit(groupKey);
  return [...resolved].sort();
}

/** Returns true when an active grant resolves to the admin capability. */
export async function resolvesActiveAdmin(
  input: ActiveCapabilityGrantInput,
  storage?: CapabilityGroupLoader,
): Promise<boolean> {
  if (!input.active) return false;
  return (await resolveCapabilities(input, storage)).includes("admin");
}

/** Returns built-in capability groups followed by durable groups, sorted by key. */
export async function listCapabilityGroups(
  storage: CapabilityGroupListStorage,
  query: { offset?: number; limit: number },
): Promise<CapabilityGroup[]> {
  if (query.limit <= 0) return [];
  const custom: CapabilityGroup[] = [];
  for (let offset = 0;; offset += query.limit) {
    const page = await storage.listPage({ offset, limit: query.limit });
    custom.push(...page.filter((group) => !BUILTIN_GROUPS.has(group.groupKey)));
    if (page.length < query.limit) break;
  }
  const all = [...BUILTIN_GROUPS.values(), ...custom].sort((left, right) =>
    left.groupKey.localeCompare(right.groupKey)
  );
  const offset = query.offset ?? 0;
  return all.slice(offset, offset + query.limit);
}

/** Returns true when the group key is reserved by a built-in group. */
export function isBuiltinCapabilityGroup(groupKey: string): boolean {
  return BUILTIN_GROUPS.has(groupKey);
}

/** Returns a built-in capability group by key, when one exists. */
export function getBuiltinCapabilityGroup(
  groupKey: string,
): CapabilityGroup | undefined {
  return BUILTIN_GROUPS.get(groupKey);
}
