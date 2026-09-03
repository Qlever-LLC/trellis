<script lang="ts">
  import { ulid } from "ulid";
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthCapabilitiesListOutput,
    AuthUsersCreateInput,
  } from "@trellis/apis/trellis.auth";
  import { resolve } from "$lib/console_paths";
  import { onMount } from "svelte";
  import ChoiceRow from "$lib/components/ChoiceRow.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import SelectionGroup from "$lib/components/SelectionGroup.svelte";
  import SelectionSectionHeader from "$lib/components/SelectionSectionHeader.svelte";
  import { errorMessage } from "$lib/format";
  import { getNotifications } from "$lib/notifications.svelte";
  import { getTrellis } from "$lib/trellis";

  type CapabilityView = AuthCapabilitiesListOutput["entries"][number] & {
    key: string;
    source: "platform" | "contract";
    contractId: string | null;
    contractDisplayName: string | null;
    consequence: string | null;
  };
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
  let selectedCapabilities = $state<string[]>([]);
  let selectedCapabilityGroups = $state<string[]>([]);
  let createdResult = $state<CreatedResult | null>(null);

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

  function buildCreateInput(_username: string): AuthUsersCreateInput {
    const input: AuthUsersCreateInput = {
      email: null,
      idempotencyKey: ulid(),
      image: null,
      name: null,
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
      const capabilitiesResponse = await trellis.authCapabilitiesList({ limit: 100 }).take();
      if (isErr(capabilitiesResponse)) { error = errorMessage(capabilitiesResponse); return; }
      capabilities = (capabilitiesResponse.entries ?? []).map((capability) => ({
        ...capability,
        key: capability.capability,
        source: capability.sourceApi ? "contract" as const : "platform" as const,
        contractId: capability.sourceApi,
        contractDisplayName: null,
        consequence: null,
      })).sort((left, right) => left.key.localeCompare(right.key));
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
      const trimmedUsername = trimmedOptional(username);
      if (!trimmedUsername) {
        error = "Username is required to create the bound local identity before issuing a password setup link.";
        return;
      }

      const createResponse = await trellis.authUsersCreate(buildCreateInput(trimmedUsername)).take();
      if (isErr(createResponse)) { error = errorMessage(createResponse); return; }

      const setupResponse = await trellis.authUsersPasswordResetCreate({
        idempotencyKey: ulid(),
        returnTarget: null,
        userId: createResponse.user.userId,
      }).take();
      if (isErr(setupResponse)) { error = errorMessage(setupResponse); return; }

      createdResult = {
        userId: createResponse.user.userId,
        setupUrl: setupResponse.flow.completionUrl,
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
    <Notice variant="error">{error}</Notice>
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
            <span class="label py-1"><span class="label-text text-xs">Username</span><span class="label-text-alt">required</span></span>
            <input class="input input-bordered input-sm trellis-identifier" bind:value={username} autocomplete="username" placeholder="local login" required />
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

      </section>

      <section class="px-5 py-3">
        <div class="flex min-w-0 flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 class="trellis-field-label">Capabilities</h3>
            <p class="trellis-field-help mt-1">Checked capabilities are submitted as exact direct capability keys.</p>
          </div>
          <span class="trellis-metadata text-xs">{selectedCapabilities.length} selected</span>
        </div>

        <SelectionGroup title="Capabilities" count={selectedCapabilities.length} bodyClass="mt-4 max-h-72 overflow-y-auto rounded border border-base-300 bg-base-100/40">
          {#each capabilitySections as section (section.key)}
            <SelectionSectionHeader title={section.title} subtitle={section.subtitle ?? undefined} count={section.capabilities.length} />
            {#each section.capabilities as capability (capability.key)}
              <ChoiceRow>
                {#snippet input()}
                  <input class="checkbox checkbox-sm mt-0.5" type="checkbox" bind:group={selectedCapabilities} value={capability.key} />
                {/snippet}
                <span class="min-w-0">
                  <span class="block truncate font-medium text-base-content" title={capability.description}>{capability.description}</span>
                  <span class="trellis-identifier mt-0.5 block break-all text-base-content/50">{localCapabilityKey(capability.key)}</span>
                  {#if capability.consequence}
                    <span class="trellis-field-help block">Consequence: {capability.consequence}</span>
                  {/if}
                </span>
              </ChoiceRow>
            {/each}
          {:else}
            <div class="px-2 py-3 trellis-metadata text-xs">No capabilities returned.</div>
          {/each}
        </SelectionGroup>
      </section>

      <section class="flex flex-wrap justify-end gap-2 px-5 py-3">
        <a class="btn btn-ghost btn-sm" href={resolve("/admin/users")}>Cancel</a>
        <button class="btn btn-primary btn-sm" type="submit" disabled={submitPending}>{submitPending ? "Creating..." : "Create user"}</button>
      </section>
    </form>
  {/if}
</section>
