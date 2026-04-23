<script lang="ts">
  import type {
    AuthDisablePortalProfileInput,
    AuthListInstalledContractsOutput,
    AuthListPortalProfilesOutput,
    AuthListPortalsOutput,
    AuthSetPortalProfileInput,
  } from "@qlever-llc/trellis-sdk/auth";
  import { isErr } from "@qlever-llc/result";
  import { onMount } from "svelte";
  import { errorMessage } from "../../../../lib/format";
  import { getNotifications } from "../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../lib/trellis";

  type PortalProfile = AuthListPortalProfilesOutput["profiles"][number];
  type PortalRecord = AuthListPortalsOutput["portals"][number];
  type ContractRecord = AuthListInstalledContractsOutput["contracts"][number];
  type SaveFeedback = {
    tone: "success" | "error";
    message: string;
  };

  const trellisPromise = getTrellis();
  const notifications = getNotifications();

  async function requestValue<T>(method: string, input: unknown): Promise<T> {
    const trellis = await trellisPromise;
    const result = await trellis.request<T>(method as string, input);
    const value = result.take();
    if (isErr(value)) throw value.error;
    return value as T;
  }

  let loading = $state(true);
  let error = $state<string | null>(null);
  let savePending = $state(false);
  let disableTarget = $state<string | null>(null);

  let profiles = $state<PortalProfile[]>([]);
  let portals = $state<PortalRecord[]>([]);
  let contracts = $state<ContractRecord[]>([]);

  let portalId = $state("");
  let entryUrl = $state("");
  let contractId = $state("");
  let allowedOriginsText = $state("");
  let editingPortalId = $state<string | null>(null);
  let saveFeedback = $state<SaveFeedback | null>(null);

  const profileById = $derived(new Map(profiles.map((profile) => [profile.portalId, profile])));
  const contractById = $derived(new Map(contracts.map((contract) => [contract.id, contract])));
  const activeProfileCount = $derived(profiles.filter((profile) => !profile.disabled).length);
  const activePortalCount = $derived(portals.filter((portal) => !portal.disabled).length);
  const currentProfile = $derived(editingPortalId ? profileById.get(editingPortalId) ?? null : null);

  function parseList(value: string): string[] {
    const values: string[] = [];

    for (const entry of value.split(/[\n,]+/).map((part) => part.trim()).filter(Boolean)) {
      if (values.includes(entry)) continue;
      values.push(entry);
    }

    return values;
  }

  function resetForm() {
    portalId = "";
    entryUrl = "";
    contractId = "";
    allowedOriginsText = "";
    editingPortalId = null;
    saveFeedback = null;
  }

  function editProfile(profile: PortalProfile) {
    portalId = profile.portalId;
    entryUrl = profile.entryUrl;
    contractId = profile.contractId;
    allowedOriginsText = (profile.allowedOrigins ?? []).join(", ");
    editingPortalId = profile.portalId;
    saveFeedback = null;
    error = null;
  }

  function contractLabel(contractId: string): string {
    const contract = contractById.get(contractId);
    return contract?.displayName ? `${contract.displayName} (${contract.id})` : contractId;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [profileRes, portalRes, contractRes] = await Promise.all([
        requestValue<AuthListPortalProfilesOutput>("Auth.ListPortalProfiles", {}),
        requestValue<AuthListPortalsOutput>("Auth.ListPortals", {}),
        requestValue<AuthListInstalledContractsOutput>("Auth.ListInstalledContracts", {}),
      ]);

      profiles = profileRes.profiles ?? [];
      portals = portalRes.portals ?? [];
      contracts = contractRes.contracts ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function saveProfile() {
    const nextPortalId = portalId.trim();
    const nextEntryUrl = entryUrl.trim();
    const nextContractId = contractId.trim();
    const nextAllowedOrigins = parseList(allowedOriginsText);
    const isUpdate = editingPortalId !== null || profileById.has(nextPortalId);

    if (!nextPortalId || !nextEntryUrl || !nextContractId) {
      error = "Portal ID, entry URL, and contract ID are required.";
      saveFeedback = { tone: "error", message: error };
      return;
    }

    savePending = true;
    error = null;
    saveFeedback = null;
    try {
      await requestValue("Auth.SetPortalProfile", {
        portalId: nextPortalId,
        entryUrl: nextEntryUrl,
        contractId: nextContractId,
        allowedOrigins: nextAllowedOrigins.length ? nextAllowedOrigins : undefined,
      } satisfies AuthSetPortalProfileInput);

      const successMessage = isUpdate
        ? `Portal profile ${nextPortalId} updated.`
        : `Portal profile ${nextPortalId} created.`;
      notifications.success(successMessage, isUpdate ? "Updated" : "Created");
      saveFeedback = { tone: "success", message: successMessage };
      resetForm();
      await load();
    } catch (e) {
      error = errorMessage(e);
      saveFeedback = { tone: "error", message: error };
      notifications.error(error, isUpdate ? "Update failed" : "Create failed");
    } finally {
      savePending = false;
    }
  }

  async function disableProfile(profile: PortalProfile) {
    if (profile.disabled) return;
    if (!window.confirm(`Disable portal profile ${profile.portalId}?`)) return;

    disableTarget = profile.portalId;
    error = null;
    saveFeedback = null;
    try {
      await requestValue("Auth.DisablePortalProfile", {
        portalId: profile.portalId,
      } satisfies AuthDisablePortalProfileInput);
      notifications.success(`Portal profile ${profile.portalId} disabled.`, "Disabled");
      if (editingPortalId === profile.portalId) {
        resetForm();
      }
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
  <div class="flex items-center justify-between gap-4">
    <div class="stats border border-base-300 shadow">
      <div class="stat px-4 py-2">
        <div class="stat-title text-xs">Active portal profiles</div>
        <div class="stat-value text-xl">{activeProfileCount}</div>
      </div>
      <div class="stat px-4 py-2">
        <div class="stat-title text-xs">Active portal records</div>
        <div class="stat-value text-xl">{activePortalCount}</div>
      </div>
    </div>

    <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
  </div>

  <div class="card border border-base-300 bg-base-100">
    <div class="card-body gap-4">
      <div>
        <h2 class="card-title text-base">Save portal profile</h2>
        <p class="text-sm text-base-content/60">Create or update the auth-owned portal profile for a portal entry point. The server now derives implied capabilities and returns them with the saved profile.</p>
      </div>

      <form class="grid gap-3 md:grid-cols-2" onsubmit={(event) => { event.preventDefault(); void saveProfile(); }}>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Portal ID</span>
          <input
            class="input input-bordered input-sm"
            bind:value={portalId}
            placeholder="portal-login"
            required
            disabled={editingPortalId !== null}
          />
          {#if editingPortalId}
            <span class="label-text-alt text-base-content/50">Portal ID is the profile key. Clear the form to create a new portal profile.</span>
          {/if}
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">Entry URL</span>
          <input class="input input-bordered input-sm" bind:value={entryUrl} placeholder="https://portal.example.com/" required />
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">Contract ID</span>
          <input class="input input-bordered input-sm" bind:value={contractId} list="installed-portal-contracts" placeholder="trellis.console@v1" required />
        </label>

        <label class="form-control gap-1 md:col-span-2">
          <span class="label-text text-xs">Allowed origins</span>
          <textarea
            class="textarea textarea-bordered textarea-sm min-h-24 font-mono"
            bind:value={allowedOriginsText}
            placeholder="https://console.example.com, https://portal.example.com"
          ></textarea>
          <span class="label-text-alt text-base-content/50">Optional comma-separated or newline-separated origins. Leave blank to allow any origin.</span>
        </label>

        <div class="md:col-span-2 flex flex-wrap items-center gap-2">
          <button type="submit" class="btn btn-primary btn-sm" disabled={savePending}>
            {savePending ? "Saving…" : currentProfile ? "Update Portal Profile" : "Create Portal Profile"}
          </button>

          <button type="button" class="btn btn-ghost btn-sm" onclick={resetForm} disabled={savePending}>
            Clear
          </button>

          {#if currentProfile}
            <span class="text-xs text-base-content/50">Editing {currentProfile.portalId}</span>
          {/if}
        </div>
      </form>

      {#if saveFeedback}
        <div class={[
          "alert",
          saveFeedback.tone === "success" ? "alert-success" : "alert-error",
        ]}>
          <span>{saveFeedback.message}</span>
        </div>
      {/if}

      <datalist id="installed-portal-contracts">
        {#each contracts as contract (contract.digest)}
          <option value={contract.id}>{contract.displayName ?? contract.id}</option>
        {/each}
      </datalist>
    </div>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  <div class="card border border-base-300 bg-base-100">
    <div class="card-body gap-4">
      <div>
        <h2 class="card-title text-base">Portal profiles</h2>
        <p class="text-sm text-base-content/60">Profiles drive portal trust and auto-approval. Listed implied capabilities are server-derived. Disable a profile to stop portal-owned approval without disabling the portal route itself.</p>
      </div>

      {#if loading}
        <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
      {:else if profiles.length === 0}
        <p class="text-sm text-base-content/60">No portal profiles found.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Portal</th>
                <th>Contract</th>
                <th>Allowed Origins</th>
                <th>Implied Capabilities</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each profiles as profile (profile.portalId)}
                <tr>
                  <td>
                    <div class="font-medium">{profile.portalId}</div>
                    <a class="link link-hover font-mono text-xs" href={profile.entryUrl} target="_blank" rel="noreferrer">{profile.entryUrl}</a>
                  </td>
                  <td>
                    <div>{contractLabel(profile.contractId)}</div>
                    <div class="font-mono text-xs text-base-content/60">{profile.contractId}</div>
                  </td>
                  <td class="text-xs text-base-content/70">
                    {#if profile.allowedOrigins?.length}
                      <div class="flex max-w-md flex-wrap gap-1">
                        {#each profile.allowedOrigins as origin (origin)}
                          <span class="badge badge-ghost badge-sm font-mono">{origin}</span>
                        {/each}
                      </div>
                    {:else}
                      <span class="text-base-content/40">Any origin</span>
                    {/if}
                  </td>
                  <td class="text-xs text-base-content/70">
                    {#if profile.impliedCapabilities.length > 0}
                      <div class="flex max-w-xl flex-wrap gap-1">
                        {#each profile.impliedCapabilities as capability (capability)}
                          <span class="badge badge-outline badge-sm font-mono">{capability}</span>
                        {/each}
                      </div>
                    {:else}
                      <span class="text-base-content/40">None</span>
                    {/if}
                  </td>
                  <td>
                    <div class="flex flex-col gap-1">
                      <span class={["badge badge-sm", profile.disabled ? "badge-ghost" : "badge-success"]}>
                        {profile.disabled ? "Disabled" : "Active"}
                      </span>
                      <span class="text-xs text-base-content/50">Updated {new Date(profile.updatedAt).toLocaleString()}</span>
                    </div>
                  </td>
                  <td class="text-right">
                    <div class="flex justify-end gap-2">
                      <button class="btn btn-ghost btn-xs" onclick={() => editProfile(profile)} disabled={savePending || disableTarget === profile.portalId}>
                        Edit
                      </button>
                      <button
                        class="btn btn-ghost btn-xs text-error"
                        onclick={() => disableProfile(profile)}
                        disabled={profile.disabled || disableTarget === profile.portalId || savePending}
                      >
                        {disableTarget === profile.portalId ? "Disabling…" : "Disable"}
                      </button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </div>

  <div class="card border border-base-300 bg-base-100">
    <div class="card-body gap-4">
      <div>
        <h2 class="card-title text-base">Portal records</h2>
        <p class="text-sm text-base-content/60">Portal records are still shown for quick operational visibility alongside the primary profile flow.</p>
      </div>

      {#if loading}
        <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
      {:else if portals.length === 0}
        <p class="text-sm text-base-content/60">No portals found.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Portal</th>
                <th>Entry URL</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {#each portals as portal (portal.portalId)}
                <tr>
                  <td class="font-medium">{portal.portalId}</td>
                  <td>
                    <a class="link link-hover font-mono text-xs" href={portal.entryUrl} target="_blank" rel="noreferrer">{portal.entryUrl}</a>
                  </td>
                  <td>
                    <span class={["badge badge-sm", portal.disabled ? "badge-ghost" : "badge-success"]}>
                      {portal.disabled ? "Disabled" : "Active"}
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="text-xs text-base-content/50">{portals.length} portal{portals.length !== 1 ? "s" : ""}</p>
      {/if}
    </div>
  </div>
</section>
