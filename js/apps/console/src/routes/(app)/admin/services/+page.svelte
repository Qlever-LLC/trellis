<script lang="ts">
  import type { AuthListServiceProfilesOutput } from "@qlever-llc/trellis-sdk/auth";
  import { onMount } from "svelte";
  import { errorMessage } from "../../../../lib/format";
  import { getNotifications } from "../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../lib/trellis";

  type Profile = AuthListServiceProfilesOutput["profiles"][number];

  const trellisPromise = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let createPending = $state(false);
  let applyPending = $state(false);
  let actionTarget = $state<string | null>(null);

  let profiles = $state<Profile[]>([]);
  let selectedProfileId = $state("");

  let profileId = $state("");
  let displayName = $state("");
  let description = $state("");
  let namespaces = $state("");
  let contractJson = $state("");

  const selectedProfile = $derived(profiles.find((profile) => profile.profileId === selectedProfileId) ?? null);

  function parseNamespaces(value: string): string[] {
    return value
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function syncSelectedProfile(nextProfiles: Profile[]) {
    if (nextProfiles.some((profile) => profile.profileId === selectedProfileId)) return;
    selectedProfileId = nextProfiles[0]?.profileId ?? "";
    contractJson = "";
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const trellis = await trellisPromise;
      const res = await trellis.requestOrThrow<AuthListServiceProfilesOutput>("Auth.ListServiceProfiles" as string, {});
      const nextProfiles = res.profiles ?? [];
      profiles = nextProfiles;
      syncSelectedProfile(nextProfiles);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function createProfile() {
    createPending = true;
    error = null;
    try {
      const nextProfileId = profileId.trim();
      const trellis = await trellisPromise;
      await trellis.requestOrThrow<void>("Auth.CreateServiceProfile" as string, {
        profileId: nextProfileId,
        displayName: displayName.trim(),
        description: description.trim() || undefined,
        namespaces: parseNamespaces(namespaces),
      });
      notifications.success(`Service profile ${nextProfileId} created.`, "Created");
      profileId = "";
      displayName = "";
      description = "";
      namespaces = "";
      selectedProfileId = nextProfileId;
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      createPending = false;
    }
  }

  async function applyContract() {
    if (!selectedProfile || !contractJson.trim()) return;
    applyPending = true;
    error = null;
    try {
      const contract = JSON.parse(contractJson) as Record<string, unknown>;
      const trellis = await trellisPromise;
      await trellis.requestOrThrow<void>("Auth.ApplyServiceProfileContract" as string, {
        profileId: selectedProfile.profileId,
        contract,
      });
      notifications.success(`Contract applied to ${selectedProfile.profileId}.`, "Applied");
      contractJson = "";
      await load();
    } catch (e) {
      error = e instanceof SyntaxError ? `Invalid contract JSON: ${e.message}` : errorMessage(e);
    } finally {
      applyPending = false;
    }
  }

  async function unapplyContract(profile: Profile, contractId: string, digests?: string[]) {
    const target = digests?.length ? `${contractId}:${digests.join(",")}` : `${contractId}:lineage`;
    const scope = digests?.length ? `digest ${digests.join(", ")}` : `lineage ${contractId}`;
    if (!window.confirm(`Unapply ${scope} from ${profile.profileId}?`)) return;
    actionTarget = `${profile.profileId}:${target}:unapply`;
    error = null;
    try {
      const trellis = await trellisPromise;
      await trellis.requestOrThrow<void>("Auth.UnapplyServiceProfileContract" as string, {
        profileId: profile.profileId,
        contractId,
        digests,
      });
      notifications.success(`Contracts updated for ${profile.profileId}.`, "Updated");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      actionTarget = null;
    }
  }

  async function setProfileDisabled(profile: Profile, disabled: boolean) {
    const verb = disabled ? "Disable" : "Enable";
    if (!window.confirm(`${verb} service profile ${profile.profileId}?`)) return;
    actionTarget = `${profile.profileId}:${verb.toLowerCase()}`;
    error = null;
    try {
      const trellis = await trellisPromise;
      await trellis.requestOrThrow<void>((disabled ? "Auth.DisableServiceProfile" : "Auth.EnableServiceProfile") as string, {
        profileId: profile.profileId,
      });
      notifications.success(`Service profile ${profile.profileId} ${disabled ? "disabled" : "enabled"}.`, disabled ? "Disabled" : "Enabled");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      actionTarget = null;
    }
  }

  async function removeProfile(profile: Profile) {
    if (!window.confirm(`Remove service profile ${profile.profileId}?`)) return;
    actionTarget = `${profile.profileId}:remove`;
    error = null;
    try {
      const trellis = await trellisPromise;
      await trellis.requestOrThrow<void>("Auth.RemoveServiceProfile" as string, { profileId: profile.profileId });
      notifications.success(`Service profile ${profile.profileId} removed.`, "Removed");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      actionTarget = null;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <div class="card border border-base-300 bg-base-100">
    <div class="card-body gap-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="card-title text-base">Service profiles</h2>
          <p class="text-sm text-base-content/60">Create profiles, apply contract JSON, and manage lifecycle state for Trellis services.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <a href="/admin/services/instances" class="btn btn-outline btn-sm">Manage Instances</a>
          <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
        </div>
      </div>

      <form class="grid gap-3 lg:grid-cols-2" onsubmit={(event) => { event.preventDefault(); void createProfile(); }}>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Profile ID</span>
          <input class="input input-bordered input-sm font-mono" bind:value={profileId} placeholder="billing.worker" required />
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">Display name</span>
          <input class="input input-bordered input-sm" bind:value={displayName} placeholder="Billing Worker" required />
        </label>

        <label class="form-control gap-1 lg:col-span-2">
          <span class="label-text text-xs">Description</span>
          <textarea class="textarea textarea-bordered textarea-sm" rows="2" bind:value={description} placeholder="Optional description"></textarea>
        </label>

        <label class="form-control gap-1 lg:col-span-2">
          <span class="label-text text-xs">Namespaces</span>
          <textarea class="textarea textarea-bordered textarea-sm font-mono" rows="3" bind:value={namespaces} placeholder="billing, invoices" required></textarea>
        </label>

        <div class="lg:col-span-2 flex justify-end">
          <button type="submit" class="btn btn-primary btn-sm" disabled={createPending}>
            {createPending ? "Creating…" : "Create Profile"}
          </button>
        </div>
      </form>
    </div>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
  {:else}
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div class="card border border-base-300 bg-base-100">
        <div class="card-body gap-3">
          <div class="flex items-center justify-between gap-2">
            <h3 class="card-title text-sm">Profiles</h3>
            <span class="text-xs text-base-content/60">{profiles.length} total</span>
          </div>

          {#if profiles.length === 0}
            <p class="text-sm text-base-content/60">No service profiles found.</p>
          {:else}
            <div class="space-y-2">
              {#each profiles as profile (profile.profileId)}
                <div
                  class={[
                    "rounded-box border p-3 transition-colors",
                    selectedProfileId === profile.profileId
                      ? "border-primary bg-primary/5"
                      : "border-base-300 bg-base-100",
                  ]}
                >
                  <button
                    class="w-full text-left"
                    onclick={() => {
                      selectedProfileId = profile.profileId;
                      contractJson = "";
                    }}
                  >
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="font-medium">{profile.displayName}</div>
                      <div class="font-mono text-xs text-base-content/60">{profile.profileId}</div>
                    </div>
                    <span class={[
                      "badge badge-sm",
                      profile.disabled ? "badge-ghost" : "badge-success",
                    ]}>
                      {profile.disabled ? "Disabled" : "Active"}
                    </span>
                  </div>

                  {#if profile.description}
                    <p class="mt-2 text-sm text-base-content/60">{profile.description}</p>
                  {/if}

                  <div class="mt-3 flex flex-wrap gap-1">
                    {#each profile.namespaces as namespace (namespace)}
                      <span class="badge badge-outline badge-xs">{namespace}</span>
                    {:else}
                      <span class="text-xs text-base-content/60">No namespaces</span>
                    {/each}
                  </div>
                  </button>
                  <div class="mt-3 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      onclick={(event) => {
                        event.stopPropagation();
                        void setProfileDisabled(profile, !profile.disabled);
                      }}
                      disabled={actionTarget === `${profile.profileId}:${profile.disabled ? "enable" : "disable"}`}
                    >
                      {profile.disabled ? "Enable" : "Disable"}
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs text-error"
                      onclick={(event) => {
                        event.stopPropagation();
                        void removeProfile(profile);
                      }}
                      disabled={actionTarget === `${profile.profileId}:remove`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="space-y-4">
        <div class="card border border-base-300 bg-base-100">
          <div class="card-body gap-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 class="card-title text-sm">Apply contract</h3>
                <p class="text-sm text-base-content/60">Paste raw contract JSON and apply it to the selected profile.</p>
              </div>
              <label class="form-control gap-1 min-w-56">
                <span class="label-text text-xs">Selected profile</span>
                <select class="select select-bordered select-sm" bind:value={selectedProfileId} disabled={profiles.length === 0}>
                  <option value="" disabled>Select a profile</option>
                  {#each profiles as profile (profile.profileId)}
                    <option value={profile.profileId}>{profile.profileId}</option>
                  {/each}
                </select>
              </label>
            </div>

            <textarea
              class="textarea textarea-bordered min-h-64 w-full font-mono text-xs"
              bind:value={contractJson}
              placeholder="Paste contract JSON…"
              disabled={!selectedProfile}
            ></textarea>

            <div class="flex justify-end">
              <button class="btn btn-primary btn-sm" onclick={applyContract} disabled={applyPending || !selectedProfile || !contractJson.trim()}>
                {applyPending ? "Applying…" : "Apply Contract"}
              </button>
            </div>
          </div>
        </div>

        <div class="card border border-base-300 bg-base-100">
          <div class="card-body gap-3">
            <div>
              <h3 class="card-title text-sm">Selected profile details</h3>
              <p class="text-sm text-base-content/60">Unapply an entire contract lineage or remove a specific digest from the selected profile.</p>
            </div>

            {#if !selectedProfile}
              <p class="text-sm text-base-content/60">Select a profile to manage contracts.</p>
            {:else}
              <div class="space-y-4">
                <div class="rounded-box border border-base-300 bg-base-100 p-3">
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div class="font-medium">{selectedProfile.displayName}</div>
                      <div class="font-mono text-xs text-base-content/60">{selectedProfile.profileId}</div>
                    </div>
                    <span class={[
                      "badge badge-sm",
                      selectedProfile.disabled ? "badge-ghost" : "badge-success",
                    ]}>
                      {selectedProfile.disabled ? "Disabled" : "Active"}
                    </span>
                  </div>
                  <div class="mt-3 flex flex-wrap gap-1">
                    {#each selectedProfile.namespaces as namespace (namespace)}
                      <span class="badge badge-outline badge-xs">{namespace}</span>
                    {/each}
                  </div>
                </div>

                {#if selectedProfile.appliedContracts.length === 0}
                  <p class="text-sm text-base-content/60">No contracts applied.</p>
                {:else}
                  <div class="space-y-3">
                    {#each selectedProfile.appliedContracts as applied (applied.contractId)}
                      <div class="rounded-box border border-base-300 bg-base-100 p-3">
                        <div class="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div class="font-medium text-sm">{applied.contractId}</div>
                            <div class="text-xs text-base-content/60">{applied.allowedDigests.length} digest(s)</div>
                          </div>
                          <button
                            class="btn btn-ghost btn-xs text-error"
                            onclick={() => unapplyContract(selectedProfile, applied.contractId)}
                            disabled={actionTarget === `${selectedProfile.profileId}:${applied.contractId}:lineage:unapply`}
                          >
                            Unapply lineage
                          </button>
                        </div>

                        <div class="mt-3 flex flex-wrap gap-2">
                          {#each applied.allowedDigests as digest (digest)}
                            <div class="flex items-center gap-1 rounded-full border border-base-300 px-2 py-1">
                              <span class="font-mono text-xs">{digest}</span>
                              <button
                                class="btn btn-ghost btn-xs text-error"
                                onclick={() => unapplyContract(selectedProfile, applied.contractId, [digest])}
                                disabled={actionTarget === `${selectedProfile.profileId}:${applied.contractId}:${digest}:unapply`}
                                aria-label={`Unapply digest ${digest}`}
                              >
                                ×
                              </button>
                            </div>
                          {/each}
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}
</section>
