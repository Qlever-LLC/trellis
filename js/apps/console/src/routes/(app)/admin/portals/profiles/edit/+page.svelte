<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthListInstalledContractsOutput,
    AuthListPortalProfilesOutput,
    AuthSetPortalProfileInput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "../../../../../../lib/format";
  import { getNotifications } from "../../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../../lib/trellis";

  type PortalProfile = AuthListPortalProfilesOutput["profiles"][number];
  type ContractRecord = AuthListInstalledContractsOutput["contracts"][number];

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let pending = $state(false);
  let error = $state<string | null>(null);
  let feedback = $state<string | null>(null);

  let profiles = $state<PortalProfile[]>([]);
  let contracts = $state<ContractRecord[]>([]);

  let portalId = $state(page.url.searchParams.get("portal") ?? "");
  let entryUrl = $state("");
  let contractId = $state("");
  let allowedOriginsText = $state("");

  const profileById = $derived(new Map(profiles.map((profile) => [profile.portalId, profile])));
  const currentProfile = $derived(portalId.trim() ? profileById.get(portalId.trim()) ?? null : null);

  function parseList(value: string): string[] {
    const values: string[] = [];

    for (const entry of value.split(/[\n,]+/).map((part) => part.trim()).filter(Boolean)) {
      if (!values.includes(entry)) values.push(entry);
    }

    return values;
  }

  function fillFromProfile(profile: PortalProfile) {
    portalId = profile.portalId;
    entryUrl = profile.entryUrl;
    contractId = profile.contractId;
    allowedOriginsText = (profile.allowedOrigins ?? []).join(", ");
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [profileRes, contractRes] = await Promise.all([
        trellis.request("Auth.ListPortalProfiles", {}).take(),
        trellis.request("Auth.ListInstalledContracts", {}).take(),
      ]);
      if (isErr(profileRes)) { error = errorMessage(profileRes); return; }
      if (isErr(contractRes)) { error = errorMessage(contractRes); return; }
      profiles = profileRes.profiles ?? [];
      contracts = contractRes.contracts ?? [];

      const selected = page.url.searchParams.get("portal");
      if (selected) {
        const profile = profiles.find((entry) => entry.portalId === selected);
        if (profile) fillFromProfile(profile);
      }
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
    const isUpdate = profileById.has(nextPortalId);

    if (!nextPortalId || !nextEntryUrl || !nextContractId) {
      error = "Portal ID, entry URL, and contract ID are required.";
      feedback = null;
      return;
    }

    pending = true;
    error = null;
    feedback = null;
    try {
      const response = await trellis.request("Auth.SetPortalProfile", {
        portalId: nextPortalId,
        entryUrl: nextEntryUrl,
        contractId: nextContractId,
        allowedOrigins: nextAllowedOrigins.length ? nextAllowedOrigins : undefined,
      } satisfies AuthSetPortalProfileInput).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      feedback = isUpdate ? `Portal profile ${nextPortalId} updated.` : `Portal profile ${nextPortalId} created.`;
      notifications.success(feedback, isUpdate ? "Updated" : "Created");
      await load();
    } catch (e) {
      error = errorMessage(e);
      notifications.error(error, isUpdate ? "Update failed" : "Create failed");
    } finally {
      pending = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Edit portal profile" description="Create or update a portal profile.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals")}>Back to portals</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if feedback}
    <div class="alert alert-success"><span>{feedback}</span></div>
  {/if}

  <Panel title="Portal profile" eyebrow={currentProfile ? "Update" : "Create"}>
    {#if loading}
      <LoadingState label="Loading portal profile data" />
    {:else}
      <form class="grid gap-3 md:grid-cols-2" onsubmit={(event) => { event.preventDefault(); void saveProfile(); }}>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Portal ID</span>
          <input class="input input-bordered input-sm" bind:value={portalId} list="portal-profile-options" placeholder="portal-login" required disabled={currentProfile !== null} />
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
          <textarea class="textarea textarea-bordered textarea-sm min-h-24 font-mono" bind:value={allowedOriginsText} placeholder="https://console.example.com, https://portal.example.com"></textarea>
          <span class="label-text-alt text-base-content/50">Optional comma-separated or newline-separated origins. Leave blank to allow any origin.</span>
        </label>

        <div class="flex flex-wrap items-center gap-2 md:col-span-2">
          <button type="submit" class="btn btn-outline btn-sm" disabled={pending}>{pending ? "Saving…" : currentProfile ? "Update Portal Profile" : "Create Portal Profile"}</button>
          <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals")}>Done</a>
        </div>
      </form>
    {/if}
  </Panel>

  <datalist id="portal-profile-options">
    {#each profiles as profile (profile.portalId)}
      <option value={profile.portalId}>{profile.entryUrl}</option>
    {/each}
  </datalist>

  <datalist id="installed-portal-contracts">
    {#each contracts as contract (contract.digest)}
      <option value={contract.id}>{contract.displayName ?? contract.id}</option>
    {/each}
  </datalist>
</section>
