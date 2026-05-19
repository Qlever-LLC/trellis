<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthCapabilitiesListOutput,
    AuthCapabilityGroupsListOutput,
    AuthUsersCreateInput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import { errorMessage } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  type CapabilityView = AuthCapabilitiesListOutput["entries"][number];
  type AssignableCapabilityGroup = AuthCapabilityGroupsListOutput["entries"][number];
  type CreatedResult = {
    userId: string;
    setupUrl: string;
  };
  type CapabilitySection = {
    key: string;
    title: string;
    subtitle: string | null;
    capabilities: CapabilityView[];
  };

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let submitPending = $state(false);
  let error = $state<string | null>(null);
  let username = $state("");
  let name = $state("");
  let email = $state("");
  let active = $state(true);
  let capabilities = $state<CapabilityView[]>([]);
  let assignableCapabilityGroups = $state<AssignableCapabilityGroup[]>([]);
  let selectedCapabilities = $state<string[]>([]);
  let selectedCapabilityGroups = $state<string[]>([]);
  let createdResult = $state<CreatedResult | null>(null);

  const sortedAssignableCapabilityGroups = $derived(assignableCapabilityGroups.slice().sort((left, right) => {
    if ((left.groupKey === "admin") !== (right.groupKey === "admin")) return left.groupKey === "admin" ? -1 : 1;
    return left.groupKey.localeCompare(right.groupKey);
  }));
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

  function uniqueCapabilities(values: string[]): string[] {
    return Array.from(new Set(values));
  }

  function trimmedOptional(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  function localCapabilityKey(key: string): string {
    return key.includes("::") ? key.split("::").slice(1).join("::") : key;
  }

  function hrefAttribute(href: string): { href: string } {
    return { href };
  }

  function buildCreateInput(): AuthUsersCreateInput {
    const input: AuthUsersCreateInput = {
      active,
      capabilities: uniqueCapabilities(selectedCapabilities),
      capabilityGroups: uniqueCapabilities(selectedCapabilityGroups),
    };
    const trimmedName = trimmedOptional(name);
    const trimmedEmail = trimmedOptional(email);
    if (trimmedName) input.name = trimmedName;
    if (trimmedEmail) input.email = trimmedEmail;
    return input;
  }

  async function loadAssignments() {
    loading = true;
    error = null;
    try {
      const [capabilitiesResponse, groupsResponse] = await Promise.all([
        trellis.request("Auth.Capabilities.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.CapabilityGroups.List", { limit: 500, offset: 0 }).take(),
      ]);
      if (isErr(capabilitiesResponse)) { error = errorMessage(capabilitiesResponse); return; }
      if (isErr(groupsResponse)) { error = errorMessage(groupsResponse); return; }
      capabilities = (capabilitiesResponse.entries ?? []).slice().sort((left, right) => left.key.localeCompare(right.key));
      assignableCapabilityGroups = groupsResponse.entries ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function createUser() {
    submitPending = true;
    error = null;
    createdResult = null;
    try {
      const createResponse = await trellis.request("Auth.Users.Create", buildCreateInput()).take();
      if (isErr(createResponse)) { error = errorMessage(createResponse); return; }

      const trimmedUsername = trimmedOptional(username);
      const setupResponse = await trellis.request("Auth.AccountFlows.CreatePasswordSetup", {
        userId: createResponse.user.userId,
        ...(trimmedUsername ? { profileHint: { username: trimmedUsername } } : {}),
      }).take();
      if (isErr(setupResponse)) { error = errorMessage(setupResponse); return; }

      createdResult = {
        userId: createResponse.user.userId,
        setupUrl: setupResponse.url,
      };
      notifications.success(`Created ${createResponse.user.name ?? createResponse.user.userId}.`, "Created");
    } catch (e) {
      error = errorMessage(e);
    } finally {
      submitPending = false;
    }
  }

  async function copySetupUrl() {
    if (!createdResult) return;
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      notifications.error("Clipboard access is unavailable in this browser.", "Copy failed");
      return;
    }

    try {
      await navigator.clipboard.writeText(createdResult.setupUrl);
      notifications.success("Setup URL copied to clipboard.", "Copied");
    } catch (e) {
      notifications.error(errorMessage(e), "Copy failed");
    }
  }

  onMount(() => {
    void loadAssignments();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="New user" description="Create a local user and generate a password setup link.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/users")}>Back to users</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if createdResult}
    <section class="divide-y divide-base-300 border-y border-base-300 bg-base-100">
      <div class="px-5 py-3">
        <p class="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-base-content/45">Created user</p>
        <p class="trellis-identifier mt-1 break-all text-sm">{createdResult.userId}</p>
      </div>
      <div class="px-5 py-3">
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-sm font-semibold">Password setup URL</h2>
            <p class="trellis-field-help mt-1">Send this portal URL to the user to complete local password setup.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-outline btn-sm" type="button" onclick={copySetupUrl}>Copy setup URL</button>
            <a class="btn btn-ghost btn-sm" {...hrefAttribute(createdResult.setupUrl)} target="_blank" rel="noreferrer">Open</a>
          </div>
        </div>
        <input class="input input-bordered input-sm mt-3 w-full trellis-identifier" readonly value={createdResult.setupUrl} aria-label="Password setup URL" />
      </div>
    </section>
  {/if}

  {#if loading}
    <div class="border-y border-base-300 bg-base-100 px-4 py-5">
      <LoadingState label="Loading assignments" />
    </div>
  {:else}
    <form class="divide-y divide-base-300 border-y border-base-300 bg-base-100" onsubmit={(event) => { event.preventDefault(); void createUser(); }}>
      <section class="px-5 py-3">
        <p class="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-base-content/45">User profile</p>
        <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label class="form-control w-full">
            <span class="label py-1"><span class="label-text text-xs">Username</span><span class="label-text-alt">optional</span></span>
            <input class="input input-bordered input-sm trellis-identifier" bind:value={username} autocomplete="username" placeholder="suggested local login" />
          </label>
          <label class="form-control w-full">
            <span class="label py-1"><span class="label-text text-xs">Name</span><span class="label-text-alt">optional</span></span>
            <input class="input input-bordered input-sm" bind:value={name} autocomplete="name" placeholder="Operator name" />
          </label>
          <label class="form-control w-full md:col-span-2">
            <span class="label py-1"><span class="label-text text-xs">Email</span><span class="label-text-alt">optional</span></span>
            <input class="input input-bordered input-sm" type="email" bind:value={email} autocomplete="email" placeholder="user@example.com" />
          </label>
        </div>
      </section>

      <label class="flex items-center justify-between gap-4 px-5 py-3">
        <span class="min-w-0">
          <span class="block text-sm font-medium">Active</span>
          <span class="trellis-field-help block">Controls whether this user can authenticate after password setup.</span>
        </span>
        <input class="toggle toggle-sm" type="checkbox" bind:checked={active} />
      </label>

      <section class="px-5 py-3">
        <div class="flex min-w-0 flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 class="trellis-field-label">Capability Groups</h3>
            <p class="trellis-field-help mt-1">No groups are selected by default.</p>
          </div>
          <span class="trellis-metadata text-xs">{selectedCapabilityGroups.length} selected</span>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 xl:grid-cols-2">
          {#each sortedAssignableCapabilityGroups as group (group.groupKey)}
            <label class="grid cursor-pointer grid-cols-[auto_1fr] gap-2 border-y border-base-300/70 py-2 text-xs hover:bg-base-200/60">
              <input class="checkbox checkbox-sm mt-0.5" type="checkbox" bind:group={selectedCapabilityGroups} value={group.groupKey} />
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
            <p class="trellis-field-help mt-1">Checked capabilities are submitted as exact direct capability keys.</p>
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
              <label class="grid cursor-pointer grid-cols-[auto_1fr] gap-2 border-b border-base-300/70 px-2 py-2 text-xs last:border-b-0 hover:bg-base-200/60">
                <input class="checkbox checkbox-sm mt-0.5" type="checkbox" bind:group={selectedCapabilities} value={capability.key} />
                <span class="min-w-0">
                  <span class="block truncate font-medium text-base-content" title={capability.description}>{capability.description}</span>
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
      </section>

      <section class="flex flex-wrap justify-end gap-2 px-5 py-3">
        <a class="btn btn-ghost btn-sm" href={resolve("/admin/users")}>Cancel</a>
        <button class="btn btn-primary btn-sm" type="submit" disabled={submitPending}>{submitPending ? "Creating..." : "Create user"}</button>
      </section>
    </form>
  {/if}
</section>
