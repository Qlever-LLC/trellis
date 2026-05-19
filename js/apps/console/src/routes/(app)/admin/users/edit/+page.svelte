<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthCapabilitiesListOutput,
    AuthCapabilityGroupsListOutput,
    AuthUsersListOutput,
    AuthUsersUpdateInput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import { errorMessage, formatDate } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  type UserView = AuthUsersListOutput["users"][number];
  type IdentityView = UserView["identities"][number];
  type CapabilityView = AuthCapabilitiesListOutput["capabilities"][number];
  type AssignableCapabilityGroup = AuthCapabilityGroupsListOutput["groups"][number];
  type CapabilitySection = {
    key: string;
    title: string;
    subtitle: string | null;
    capabilities: CapabilityView[];
  };
  type CapabilityProviderIndex = Record<string, string[]>;

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let targetUser = $state<UserView | null>(null);
  let capabilities = $state<CapabilityView[]>([]);
  let assignableCapabilityGroups = $state<AssignableCapabilityGroup[]>([]);
  let selectedCapabilities = $state<string[]>([]);
  let selectedCapabilityGroups = $state<string[]>([]);
  let active = $state(true);
  let savePending = $state(false);

  const requestedUserId = $derived(page.url.searchParams.get("userId") ?? "");
  const hasTargetParams = $derived(requestedUserId.length > 0);
  const unavailableSelectedCapabilities = $derived(selectedCapabilities.filter((key) => !hasCapability(key)).sort());
  const sortedAssignableCapabilityGroups = $derived(assignableCapabilityGroups.slice().sort((left, right) => {
    if ((left.groupKey === "admin") !== (right.groupKey === "admin")) return left.groupKey === "admin" ? -1 : 1;
    return left.groupKey.localeCompare(right.groupKey);
  }));
  const groupProvidedCapabilityProviders = $derived.by(() => {
    const providers: CapabilityProviderIndex = {};

    for (const selectedGroupKey of selectedCapabilityGroups) {
      collectGroupCapabilities(selectedGroupKey, assignableCapabilityGroups, new Set(), (capabilityKey) => {
        providers[capabilityKey] = uniqueCapabilities([...(providers[capabilityKey] ?? []), selectedGroupKey]).sort();
      });
    }

    return providers;
  });
  const groupProvidedCapabilities = $derived(Object.keys(groupProvidedCapabilityProviders));
  const capabilitySections = $derived.by(() => {
    const sections: CapabilitySection[] = [];

    for (const capability of capabilities) {
      const sectionKey = capabilitySectionKey(capability);
      const existing = sections.find((section) => section.key === sectionKey);
      if (existing) {
        existing.capabilities.push(capability);
        continue;
      }

      sections.push({
        key: sectionKey,
        title: capabilitySectionTitle(capability),
        subtitle: capabilitySectionSubtitle(capability),
        capabilities: [capability],
      });
    }

    return sections
      .map((section) => ({
        ...section,
        capabilities: section.capabilities.slice().sort((left, right) =>
          localCapabilityKey(left.key).localeCompare(localCapabilityKey(right.key))
        ),
      }))
      .sort((left, right) => {
        if (left.key === "platform") return -1;
        if (right.key === "platform") return 1;
        return left.title.localeCompare(right.title) || left.key.localeCompare(right.key);
      });
  });

  function capabilitySectionKey(capability: CapabilityView): string {
    if (capability.source === "platform") return "platform";
    return capability.contractId ?? capability.contractDisplayName ?? "contract";
  }

  function capabilitySectionTitle(capability: CapabilityView): string {
    if (capability.source === "platform") return "Platform";
    return capability.contractDisplayName ?? capability.contractId ?? "Contract";
  }

  function capabilitySectionSubtitle(capability: CapabilityView): string | null {
    if (capability.source === "platform") return null;
    return capability.contractId ?? null;
  }

  function hasCapability(capabilityKey: string): boolean {
    return capabilities.some((capability) => capability.key === capabilityKey);
  }

  function uniqueCapabilities(values: string[]): string[] {
    return Array.from(new Set(values));
  }

  function collectGroupCapabilities(
    groupKey: string,
    groups: AssignableCapabilityGroup[],
    visitedGroupKeys: Set<string>,
    visitCapability: (capabilityKey: string) => void,
  ) {
    if (visitedGroupKeys.has(groupKey)) return;
    visitedGroupKeys.add(groupKey);

    const group = groups.find((item) => item.groupKey === groupKey);
    if (!group) return;

    for (const capabilityKey of group.capabilities) visitCapability(capabilityKey);
    for (const includedGroupKey of group.includedGroups) {
      collectGroupCapabilities(includedGroupKey, groups, visitedGroupKeys, visitCapability);
    }
  }

  function resolveGroupProvidedCapabilities(groupKeys: string[]): string[] {
    const provided: string[] = [];
    for (const groupKey of groupKeys) {
      collectGroupCapabilities(groupKey, assignableCapabilityGroups, new Set(), (capabilityKey) => {
        if (!provided.includes(capabilityKey)) provided.push(capabilityKey);
      });
    }
    return provided;
  }

  function pruneGroupProvidedDirectCapabilities(groupKeys: string[], capabilityKeys: string[]): string[] {
    const provided = resolveGroupProvidedCapabilities(groupKeys);
    return capabilityKeys.filter((capabilityKey) => !provided.includes(capabilityKey));
  }

  function groupProvidedCapabilityLabel(capabilityKey: string): string {
    return (groupProvidedCapabilityProviders[capabilityKey] ?? []).join(", ");
  }

  function setCapabilityGroupSelected(groupKey: string, selected: boolean) {
    const nextGroups = selected
      ? uniqueCapabilities([...selectedCapabilityGroups, groupKey])
      : selectedCapabilityGroups.filter((selectedGroupKey) => selectedGroupKey !== groupKey);
    selectedCapabilityGroups = nextGroups;
    selectedCapabilities = pruneGroupProvidedDirectCapabilities(nextGroups, selectedCapabilities);
  }

  function setDirectCapabilitySelected(capabilityKey: string, selected: boolean) {
    if (groupProvidedCapabilities.includes(capabilityKey)) return;

    selectedCapabilities = selected
      ? uniqueCapabilities([...selectedCapabilities, capabilityKey])
      : selectedCapabilities.filter((selectedCapabilityKey) => selectedCapabilityKey !== capabilityKey);
  }

  function handleCapabilityGroupChange(groupKey: string, event: Event) {
    setCapabilityGroupSelected(groupKey, (event.currentTarget as HTMLInputElement).checked);
  }

  function handleDirectCapabilityChange(capabilityKey: string, event: Event) {
    setDirectCapabilitySelected(capabilityKey, (event.currentTarget as HTMLInputElement).checked);
  }

  function localCapabilityKey(key: string): string {
    return key.includes("::") ? key.split("::").slice(1).join("::") : key;
  }

  function providerSubject(identity: IdentityView): string {
    return `${identity.provider}:${identity.subject}`;
  }

  function loadUserIntoForm(user: UserView | null) {
    if (!user) return;
    const loadedCapabilityGroups = uniqueCapabilities(user.capabilityGroups);
    selectedCapabilityGroups = loadedCapabilityGroups;
    selectedCapabilities = pruneGroupProvidedDirectCapabilities(loadedCapabilityGroups, uniqueCapabilities(user.capabilities));
    active = user.active;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      targetUser = null;
      if (!hasTargetParams) return;

      const [usersResponse, capabilitiesResponse, groupsResponse] = await Promise.all([
        trellis.request("Auth.Users.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.Capabilities.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.CapabilityGroups.List", { limit: 500, offset: 0 }).take(),
      ]);
      if (isErr(usersResponse)) { error = errorMessage(usersResponse); return; }
      if (isErr(capabilitiesResponse)) { error = errorMessage(capabilitiesResponse); return; }
      if (isErr(groupsResponse)) { error = errorMessage(groupsResponse); return; }
      capabilities = (capabilitiesResponse.capabilities ?? []).slice().sort((left, right) => left.key.localeCompare(right.key));
      assignableCapabilityGroups = groupsResponse.groups ?? [];
      const users = usersResponse.users ?? [];
      const match = users.find((user) => user.userId === requestedUserId) ?? null;
      targetUser = match;
      loadUserIntoForm(match);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function saveUser() {
    if (!targetUser) return;
    savePending = true;
    error = null;
    try {
      const response = await trellis.request("Auth.Users.Update", {
        userId: targetUser.userId,
        active,
        capabilities: uniqueCapabilities(selectedCapabilities),
        capabilityGroups: uniqueCapabilities(selectedCapabilityGroups),
      } satisfies AuthUsersUpdateInput).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Updated ${targetUser.name ?? targetUser.userId}.`, "Updated");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      savePending = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Edit user" description="Update activation and capabilities for a user.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/users")}>Back to users</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="border-y border-base-300 bg-base-100 px-4 py-5">
      <LoadingState label="Loading users" />
    </div>
  {:else if !hasTargetParams}
    <EmptyState title="Choose a user" description="Open the Users table and choose Edit from the user's row actions.">
      {#snippet actions()}
        <a class="btn btn-outline btn-sm" href={resolve("/admin/users")}>Back to users</a>
      {/snippet}
    </EmptyState>
  {:else if !targetUser}
    <EmptyState title="User not found" description="The selected user no longer exists or the edit link is stale.">
      {#snippet actions()}
        <a class="btn btn-outline btn-sm" href={resolve("/admin/users")}>Back to users</a>
      {/snippet}
    </EmptyState>
  {:else}
    <form class="divide-y divide-base-300 border-y border-base-300 bg-base-100" onsubmit={(event) => { event.preventDefault(); void saveUser(); }}>
      <section class="px-5 py-3">
        <p class="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-base-content/45">Workflow</p>
        <div class="mt-1 flex min-w-0 flex-wrap items-end justify-between gap-3">
          <div class="min-w-0">
            <h2 class="truncate text-base font-bold leading-tight">{targetUser.name ?? targetUser.userId}</h2>
            <p class="trellis-metadata mt-1">{targetUser.email ?? "No email"}</p>
            <p class="trellis-identifier mt-1 break-all text-base-content/60">{targetUser.userId}</p>
          </div>
          <a class="btn btn-ghost btn-sm" href={resolve("/admin/users")}>Cancel</a>
        </div>
      </section>

      <label class="flex items-center justify-between gap-4 px-5 py-3">
        <span class="min-w-0">
          <span class="block text-sm font-medium">Active</span>
          <span class="trellis-field-help block">Controls whether this user can authenticate and use assigned capabilities.</span>
        </span>
        <input class="toggle toggle-sm" type="checkbox" bind:checked={active} />
      </label>

      <section class="px-5 py-3">
        <div class="flex min-w-0 flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 class="trellis-field-label">Linked identities</h3>
            <p class="trellis-field-help mt-1">Users add identities from Profile after proving control of an enabled provider.</p>
          </div>
          <span class="trellis-metadata text-xs">{targetUser.identities.length} linked</span>
        </div>

        <div class="mt-3 overflow-x-auto border-y border-base-300">
          <table class="table table-sm trellis-table">
            <thead>
              <tr>
                <th>Provider subject</th>
                <th>Identity ID</th>
                <th>Email / display</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {#each targetUser.identities as identity (identity.identityId)}
                <tr>
                  <td class="align-top"><span class="trellis-identifier break-all">{providerSubject(identity)}</span></td>
                  <td class="align-top"><span class="trellis-identifier break-all text-base-content/60">{identity.identityId}</span></td>
                  <td class="align-top text-xs text-base-content/60">
                    <div>{identity.email ?? "No email"}</div>
                    <div>{identity.displayName ?? "No display name"}</div>
                  </td>
                  <td class="align-top text-xs text-base-content/60">
                    <div>Last {identity.lastLoginAt ? formatDate(identity.lastLoginAt) : "—"}</div>
                    <div>Linked {identity.linkedAt ? formatDate(identity.linkedAt) : "—"}</div>
                  </td>
                </tr>
              {:else}
                <tr><td colspan="4" class="trellis-metadata py-4 text-xs">No linked identities.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <section class="px-5 py-3">
        <div class="flex min-w-0 flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 class="trellis-field-label">Capability Groups</h3>
            <p class="trellis-field-help mt-1">Group assignments are submitted separately from direct capabilities. Built-in groups are assignable.</p>
          </div>
          <span class="trellis-metadata text-xs">{selectedCapabilityGroups.length} selected</span>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 xl:grid-cols-2">
          {#each sortedAssignableCapabilityGroups as group (group.groupKey)}
            <label class="grid cursor-pointer grid-cols-[auto_1fr] gap-2 border-y border-base-300/70 py-2 text-xs hover:bg-base-200/60">
              <input
                class="checkbox checkbox-sm mt-0.5"
                type="checkbox"
                checked={selectedCapabilityGroups.includes(group.groupKey)}
                onchange={(event) => handleCapabilityGroupChange(group.groupKey, event)}
              />
              <span class="min-w-0 pr-2">
                <span class="flex min-w-0 items-center gap-2">
                  <span class="trellis-identifier truncate font-medium text-base-content">{group.groupKey}</span>
                  {#if group.groupKey === "admin"}<span class="badge badge-neutral badge-xs shrink-0">built-in/read-only</span>{/if}
                </span>
                <span class="mt-0.5 block truncate text-base-content/60" title={group.displayName}>{group.displayName}</span>
                <span class="trellis-field-help block">{group.capabilities.length} capabilities, {group.includedGroups.length} included groups</span>
              </span>
            </label>
          {:else}
            <div class="border-y border-base-300 py-4 trellis-metadata text-xs">No capability groups were returned.</div>
          {/each}
        </div>
      </section>

      <section class="px-5 py-3">
        <div class="flex min-w-0 flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 class="trellis-field-label">Capabilities</h3>
            <p class="trellis-field-help mt-1">Checked capabilities are submitted as exact capability keys.</p>
          </div>
          <span class="trellis-metadata text-xs">{selectedCapabilities.length} selected</span>
        </div>

        <div class="mt-4 max-h-72 overflow-y-auto rounded border border-base-300 bg-base-100/40">
          {#each capabilitySections as section (section.key)}
            <div class="sticky top-0 z-10 border-b border-base-300 bg-base-200 px-2 py-1.5">
              <div class="flex min-w-0 items-baseline justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-xs font-semibold uppercase tracking-wide text-base-content/70">{section.title}</div>
                  {#if section.subtitle}
                    <div class="trellis-identifier truncate text-[0.65rem] text-base-content/50">{section.subtitle}</div>
                  {/if}
                </div>
                <span class="trellis-metadata text-[0.65rem]">{section.capabilities.length}</span>
              </div>
            </div>
            {#each section.capabilities as capability (capability.key)}
              {@const providedByGroup = groupProvidedCapabilities.includes(capability.key)}
              <label class="grid cursor-pointer grid-cols-[auto_1fr] gap-2 border-b border-base-300/70 px-2 py-2 text-xs last:border-b-0 hover:bg-base-200/60">
                <input
                  class="checkbox checkbox-sm mt-0.5"
                  type="checkbox"
                  checked={selectedCapabilities.includes(capability.key) || providedByGroup}
                  disabled={providedByGroup}
                  onchange={(event) => handleDirectCapabilityChange(capability.key, event)}
                />
                <span class="min-w-0">
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="block truncate font-medium text-base-content" title={capability.description}>{capability.description}</span>
                    {#if providedByGroup}<span class="badge badge-ghost badge-xs shrink-0" title={groupProvidedCapabilityLabel(capability.key)}>from group</span>{/if}
                  </span>
                  <span class="trellis-identifier mt-0.5 block break-all text-base-content/50">{localCapabilityKey(capability.key)}</span>
                  {#if capability.consequence}
                    <span class="trellis-field-help block">Consequence: {capability.consequence}</span>
                  {/if}
                </span>
              </label>
            {/each}
          {:else}
            <div class="px-2 py-3 trellis-metadata text-xs">No capabilities returned.</div>
          {/each}
        </div>

        {#if unavailableSelectedCapabilities.length > 0}
          <div class="mt-4 border-t border-base-300 pt-3">
            <div class="mb-1 text-[0.68rem] font-semibold uppercase text-base-content/50">Assigned but unavailable</div>
            <div class="divide-y divide-base-300/70">
              {#each unavailableSelectedCapabilities as capabilityKey (capabilityKey)}
                <label class="grid cursor-pointer grid-cols-[auto_1fr] gap-2 py-2 text-xs hover:bg-base-200/60">
                  <input
                    class="checkbox checkbox-sm mt-0.5"
                    type="checkbox"
                    checked={selectedCapabilities.includes(capabilityKey)}
                    onchange={(event) => handleDirectCapabilityChange(capabilityKey, event)}
                  />
                  <span class="min-w-0 pr-2">
                    <span class="block font-medium text-base-content">Existing assignment not returned by available capabilities.</span>
                    <span class="trellis-identifier mt-0.5 block break-all text-base-content/50">{localCapabilityKey(capabilityKey)}</span>
                  </span>
                </label>
              {/each}
            </div>
          </div>
        {/if}

      </section>

      <section class="flex flex-wrap justify-end gap-2 px-5 py-3">
        <a class="btn btn-ghost btn-sm" href={resolve("/admin/users")}>Cancel</a>
        <button class="btn btn-primary btn-sm" type="submit" disabled={savePending}>{savePending ? "Saving..." : "Save user"}</button>
      </section>
    </form>
  {/if}
</section>
