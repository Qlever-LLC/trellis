<script lang="ts">
  import type {
    AuthCreateDeviceProfileInput,
    AuthDisableDeviceProfileInput,
    AuthListDeviceProfilesInput,
    AuthListDeviceProfilesOutput,
    AuthListInstalledContractsOutput,
  } from "@qlever-llc/trellis-sdk/auth";
  import { isErr } from "@qlever-llc/result";
  import { onMount } from "svelte";
  import { errorMessage } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  type Profile = AuthListDeviceProfilesOutput["profiles"][number];
  type InstalledContract = AuthListInstalledContractsOutput["contracts"][number];
  type DisabledFilter = "all" | "active" | "disabled";

  const trellisPromise = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let createPending = $state(false);
  let disableTarget = $state<string | null>(null);

  let profiles = $state<Profile[]>([]);
  let contracts = $state<InstalledContract[]>([]);

  let contractFilter = $state("");
  let disabledFilter = $state<DisabledFilter>("all");

  let profileId = $state("");
  let contractId = $state("");
  let allowedDigests = $state("");
  let reviewMode = $state<"none" | "required">("none");
  let contractJson = $state("");

  function contractOptions() {
    return contracts.map((contract) => contract.id);
  }

  function profileQuery(): AuthListDeviceProfilesInput {
    return {
      disabled: disabledFilter === "all" ? undefined : disabledFilter === "disabled",
    };
  }

  function matchesContractFilter(profile: Profile): boolean {
    const filter = contractFilter.trim().toLowerCase();
    if (!filter) return true;
    return profile.appliedContracts.some((entry) =>
      entry.contractId.toLowerCase().includes(filter)
    );
  }

  const filteredProfiles = $derived.by(() =>
    profiles.filter((profile) => matchesContractFilter(profile))
  );

  function parseDigestList(value: string): string[] {
    return value
      .split(/[\s,]+/)
      .map((digest) => digest.trim())
      .filter(Boolean);
  }

  async function requestOrThrow<T>(method: string, input: unknown): Promise<T> {
    const trellis = await trellisPromise;
    const result = await trellis.request<T>(method as string, input);
    const value = result.take();
    if (isErr(value)) throw value.error;
    return value as T;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [profilesResponse, contractsResponse] = await Promise.all([
        requestOrThrow<AuthListDeviceProfilesOutput>("Auth.ListDeviceProfiles", profileQuery()),
        requestOrThrow<AuthListInstalledContractsOutput>("Auth.ListInstalledContracts", {}),
      ]);

      profiles = profilesResponse.profiles ?? [];
      contracts = contractsResponse.contracts ?? [];
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
      const digests = parseDigestList(allowedDigests);
      const input: AuthCreateDeviceProfileInput = {
        profileId: profileId.trim(),
        reviewMode,
      };

      await requestOrThrow("Auth.CreateDeviceProfile", input);
      notifications.success(`Device profile ${input.profileId} created.`, "Created");
      profileId = "";
      contractId = "";
      allowedDigests = "";
      reviewMode = "none";
      contractJson = "";
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      createPending = false;
    }
  }

  async function disableProfile(profile: Profile) {
    if (profile.disabled) return;
    if (!window.confirm(`Disable device profile ${profile.profileId}?`)) return;

    disableTarget = profile.profileId;
    error = null;
    try {
      await requestOrThrow(
        "Auth.DisableDeviceProfile",
        { profileId: profile.profileId } satisfies AuthDisableDeviceProfileInput,
      );
      notifications.success(`Device profile ${profile.profileId} disabled.`, "Disabled");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      disableTarget = null;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <div class="card border border-base-300 bg-base-100">
    <div class="card-body gap-4">
      <div>
        <h2 class="card-title text-base">Create device profile</h2>
        <p class="text-sm text-base-content/60">Profiles control allowed contract digests and whether activation needs review.</p>
      </div>

      <form class="grid gap-3 lg:grid-cols-2" onsubmit={(event) => { event.preventDefault(); void createProfile(); }}>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Profile ID</span>
          <input class="input input-bordered input-sm" bind:value={profileId} placeholder="reader.default" required />
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">Contract ID</span>
          <input class="input input-bordered input-sm" bind:value={contractId} list="installed-contract-ids" placeholder="acme.reader@v1" required />
        </label>

        <label class="form-control gap-1 lg:col-span-2">
          <span class="label-text text-xs">Allowed digests</span>
          <textarea
            class="textarea textarea-bordered text-sm font-mono"
            rows="3"
            bind:value={allowedDigests}
            placeholder="digest-v1, digest-v2"
            required
          ></textarea>
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">Review mode</span>
          <select class="select select-bordered select-sm" bind:value={reviewMode}>
            <option value="none">No review</option>
            <option value="required">Review required</option>
          </select>
        </label>

        <div class="flex items-end justify-end">
          <button type="submit" class="btn btn-primary btn-sm" disabled={createPending}>
            {createPending ? "Creating…" : "Create Profile"}
          </button>
        </div>

        <label class="form-control gap-1 lg:col-span-2">
          <span class="label-text text-xs">Contract JSON (optional)</span>
          <textarea
            class="textarea textarea-bordered text-xs font-mono"
            rows="8"
            bind:value={contractJson}
            placeholder="Paste contract JSON if the device contract is not already installed..."
          ></textarea>
        </label>
      </form>

      <datalist id="installed-contract-ids">
        {#each contractOptions() as id (id)}
          <option value={id}></option>
        {/each}
      </datalist>
    </div>
  </div>

  <div class="flex flex-wrap items-end justify-between gap-3">
    <form class="flex flex-wrap items-end gap-2" onsubmit={(event) => { event.preventDefault(); void load(); }}>
      <label class="form-control gap-1">
        <span class="label-text text-xs">Contract filter</span>
        <input class="input input-bordered input-sm w-56" bind:value={contractFilter} list="installed-contract-ids" placeholder="Any contract" />
      </label>

      <label class="form-control gap-1">
        <span class="label-text text-xs">Status</span>
        <select class="select select-bordered select-sm w-36" bind:value={disabledFilter}>
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
      </label>

      <button type="submit" class="btn btn-primary btn-sm" disabled={loading}>Apply</button>
    </form>

    <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
  {:else if filteredProfiles.length === 0}
    <p class="text-sm text-base-content/60">No device profiles found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Profile</th>
            <th>Contract</th>
            <th>Allowed Digests</th>
            <th>Review</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each filteredProfiles as profile (profile.profileId)}
            <tr>
              <td class="font-medium">{profile.profileId}</td>
              <td class="text-base-content/60">
                {#if profile.appliedContracts.length === 0}
                  <span class="text-base-content/40">None</span>
                {:else}
                  <div class="flex flex-col gap-1">
                    {#each profile.appliedContracts as applied (applied.contractId)}
                      <span>{applied.contractId}</span>
                    {/each}
                  </div>
                {/if}
              </td>
              <td>
                {#if profile.appliedContracts.length === 0}
                  <span class="text-base-content/40">None</span>
                {:else}
                  <div class="flex flex-wrap gap-1">
                    {#each profile.appliedContracts as applied (applied.contractId)}
                      {#each applied.allowedDigests as digest (digest)}
                        <span class="badge badge-outline badge-xs font-mono">{digest}</span>
                      {/each}
                    {/each}
                  </div>
                {/if}
              </td>
              <td class="text-base-content/60">{profile.reviewMode ?? "none"}</td>
              <td>
                {#if profile.disabled}
                  <span class="badge badge-ghost badge-sm">Disabled</span>
                {:else}
                  <span class="badge badge-success badge-sm">Active</span>
                {/if}
              </td>
              <td class="text-right">
                <button
                  class="btn btn-ghost btn-xs text-error"
                  onclick={() => disableProfile(profile)}
                  disabled={profile.disabled || disableTarget === profile.profileId}
                >
                  {disableTarget === profile.profileId ? "Disabling…" : "Disable"}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-base-content/50">{filteredProfiles.length} profile{filteredProfiles.length !== 1 ? "s" : ""}</p>
  {/if}
</section>
