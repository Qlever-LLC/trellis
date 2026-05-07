<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthListCapabilitiesOutput,
    AuthListUsersOutput,
    AuthUpdateUserInput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import { errorMessage } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  type UserView = AuthListUsersOutput["users"][number];
  type CapabilityView = AuthListCapabilitiesOutput["capabilities"][number];
  type CapabilityGroup = {
    key: string;
    title: string;
    sortKey: string;
    source: CapabilityView["source"];
    contractId?: string;
    capabilities: CapabilityView[];
  };

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let targetUser = $state<UserView | null>(null);
  let capabilities = $state<CapabilityView[]>([]);
  let selectedCapabilities = $state<string[]>([]);
  let active = $state(true);
  let savePending = $state(false);

  const requestedUserId = $derived(page.url.searchParams.get("user") ?? "");
  const requestedOrigin = $derived(page.url.searchParams.get("origin") ?? "");
  const hasTargetParams = $derived(requestedUserId.length > 0 && requestedOrigin.length > 0);
  const catalogedCapabilityKeys = $derived(new Set(capabilities.map((capability) => capability.key)));
  const uncatalogedSelectedCapabilities = $derived(selectedCapabilities.filter((key) => !catalogedCapabilityKeys.has(key)).sort());
  const capabilityGroups = $derived.by(() => {
    const groups: CapabilityGroup[] = [];

    for (const capability of capabilities) {
      const groupKey = capabilityGroupKey(capability);
      const existing = groups.find((group) => group.key === groupKey);
      if (existing) {
        existing.capabilities.push(capability);
        continue;
      }

      groups.push({
        key: groupKey,
        title: capabilityGroupTitle(capability),
        sortKey: capabilityGroupSortKey(capability),
        source: capability.source,
        contractId: capability.contractId,
        capabilities: [capability],
      });
    }

    return groups
      .map((group) => ({
        ...group,
        capabilities: group.capabilities.slice().sort((left, right) => left.key.localeCompare(right.key)),
      }))
      .sort((left, right) => {
        if (left.source !== right.source) return left.source === "platform" ? -1 : 1;
        return left.sortKey.localeCompare(right.sortKey);
      });
  });

  function capabilityGroupKey(capability: CapabilityView): string {
    if (capability.source === "platform") return "platform";
    return `contract:${capability.contractId ?? "unknown"}`;
  }

  function capabilityGroupTitle(capability: CapabilityView): string {
    if (capability.source === "platform") return "Platform";
    return capability.contractDisplayName ?? capability.contractId ?? "Unknown contract";
  }

  function capabilityGroupSortKey(capability: CapabilityView): string {
    if (capability.source === "platform") return "";
    return `${capabilityGroupTitle(capability)}:${capability.contractId ?? ""}`;
  }

  function uniqueCapabilities(values: string[]): string[] {
    return Array.from(new Set(values));
  }

  function localCapabilityKey(key: string): string {
    return key.includes("::") ? key.split("::").slice(1).join("::") : key;
  }

  function loadUserIntoForm(user: UserView | null) {
    if (!user) return;
    selectedCapabilities = uniqueCapabilities(user.capabilities);
    active = user.active;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      targetUser = null;
      if (!hasTargetParams) return;

      const [usersResponse, capabilitiesResponse] = await Promise.all([
        trellis.request("Auth.ListUsers", {}).take(),
        trellis.request("Auth.ListCapabilities", {}).take(),
      ]);
      if (isErr(usersResponse)) { error = errorMessage(usersResponse); return; }
      if (isErr(capabilitiesResponse)) { error = errorMessage(capabilitiesResponse); return; }
      capabilities = (capabilitiesResponse.capabilities ?? []).slice().sort((left, right) => left.key.localeCompare(right.key));
      const users = usersResponse.users ?? [];
      const match = users.find((user) => user.id === requestedUserId && user.origin === requestedOrigin) ?? null;
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
      const response = await trellis.request("Auth.UpdateUser", {
        origin: targetUser.origin,
        id: targetUser.id,
        active,
        capabilities: uniqueCapabilities(selectedCapabilities),
      } satisfies AuthUpdateUserInput).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Updated ${targetUser.name ?? targetUser.id}.`, "Updated");
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
            <h2 class="truncate text-base font-bold leading-tight">{targetUser.name ?? targetUser.id}</h2>
            <p class="trellis-metadata mt-1">{targetUser.email ?? "No email"}</p>
            <p class="trellis-identifier mt-1 break-all text-base-content/60">{targetUser.origin}:{targetUser.id}</p>
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
            <h3 class="trellis-field-label">Capabilities</h3>
            <p class="trellis-field-help mt-1">Checked capabilities are submitted as exact capability keys.</p>
          </div>
          <span class="trellis-metadata text-xs">{selectedCapabilities.length} selected</span>
        </div>

        {#if capabilities.length === 0}
          <div class="mt-4 border-y border-base-300 py-4 trellis-metadata text-xs">No cataloged capabilities were returned.</div>
        {:else}
          <div class="mt-4 grid grid-cols-1 gap-x-6 gap-y-5 xl:grid-cols-2 2xl:grid-cols-3">
            {#each capabilityGroups as group (group.key)}
              <section class="min-w-0">
                <div class="border-b border-base-300 pb-2">
                  <div class="flex min-w-0 items-center justify-between gap-2">
                    <div class="min-w-0">
                      <h4 class="truncate text-xs font-semibold">{group.title}</h4>
                      {#if group.contractId}
                        <div class="trellis-identifier truncate text-[0.65rem] text-base-content/50">{group.contractId}</div>
                      {/if}
                    </div>
                    <span class="badge badge-ghost badge-xs shrink-0">{group.source}</span>
                  </div>
                </div>
                <div class="divide-y divide-base-300/70">
                  {#each group.capabilities as capability (capability.key)}
                    <label class="grid cursor-pointer grid-cols-[auto_1fr] gap-2 py-2 text-xs hover:bg-base-200/60">
                      <input class="checkbox checkbox-sm mt-0.5" type="checkbox" bind:group={selectedCapabilities} value={capability.key} />
                      <span class="min-w-0 pr-2">
                        <span class="block font-medium text-base-content">{capability.description}</span>
                        <span class="trellis-identifier mt-0.5 block break-all text-base-content/50">{localCapabilityKey(capability.key)}</span>
                        {#if capability.consequence}
                          <span class="trellis-field-help block">Consequence: {capability.consequence}</span>
                        {/if}
                      </span>
                    </label>
                  {/each}
                </div>
              </section>
            {/each}
          </div>
        {/if}

        {#if uncatalogedSelectedCapabilities.length > 0}
          <div class="mt-4 border-t border-base-300 pt-3">
            <div class="mb-1 text-[0.68rem] font-semibold uppercase text-base-content/50">Assigned but uncataloged</div>
            <div class="divide-y divide-base-300/70">
              {#each uncatalogedSelectedCapabilities as capabilityKey (capabilityKey)}
                <label class="grid cursor-pointer grid-cols-[auto_1fr] gap-2 py-2 text-xs hover:bg-base-200/60">
                  <input class="checkbox checkbox-sm mt-0.5" type="checkbox" bind:group={selectedCapabilities} value={capabilityKey} />
                  <span class="min-w-0 pr-2">
                    <span class="block font-medium text-base-content">Existing assignment not returned by the capability catalog.</span>
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
