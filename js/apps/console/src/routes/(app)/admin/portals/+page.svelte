<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthListInstalledContractsOutput,
    AuthListPortalProfilesOutput,
    AuthListPortalsOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import InlineMetricsStrip from "$lib/components/InlineMetricsStrip.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { errorMessage } from "../../../../lib/format";
  import { getTrellis } from "../../../../lib/trellis";

  type PortalProfile = AuthListPortalProfilesOutput["profiles"][number];
  type PortalRecord = AuthListPortalsOutput["portals"][number];
  type ContractRecord = AuthListInstalledContractsOutput["contracts"][number];
  const trellis = getTrellis();

  let loading = $state(true);
  let error = $state<string | null>(null);

  let profiles = $state<PortalProfile[]>([]);
  let portals = $state<PortalRecord[]>([]);
  let contracts = $state<ContractRecord[]>([]);

  const contractById = $derived(new Map(contracts.map((contract) => [contract.id, contract])));
  const activeProfileCount = $derived(profiles.filter((profile) => !profile.disabled).length);
  const activePortalCount = $derived(portals.filter((portal) => !portal.disabled).length);

  function contractLabel(contractId: string): string {
    const contract = contractById.get(contractId);
    return contract?.displayName ? `${contract.displayName} (${contract.id})` : contractId;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [profileRes, portalRes, contractRes] = await Promise.all([
        trellis.request("Auth.ListPortalProfiles", {}).take(),
        trellis.request("Auth.ListPortals", {}).take(),
        trellis.request("Auth.ListInstalledContracts", {}).take(),
      ]);
      if (isErr(profileRes)) { error = errorMessage(profileRes); return; }
      if (isErr(portalRes)) { error = errorMessage(portalRes); return; }
      if (isErr(contractRes)) { error = errorMessage(contractRes); return; }

      profiles = profileRes.profiles ?? [];
      portals = portalRes.portals ?? [];
      contracts = contractRes.contracts ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Portals" description="Configure portal profiles and review live portal records.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  <InlineMetricsStrip metrics={[{ label: "Active profiles", value: activeProfileCount }, { label: "Active records", value: activePortalCount }]} />

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  <Panel title="Portal profiles" eyebrow="Primary table">
    {#snippet actions()}
      <details class="dropdown dropdown-end">
        <summary class="btn btn-outline btn-sm">Actions <Icon name="chevronDown" size={14} /></summary>
        <ul class="menu dropdown-content z-10 mt-2 w-72 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
          <li><a href={resolve("/admin/portals/profiles/edit")}>Create portal profile</a></li>
          <li><a href={resolve("/admin/portals/profiles/edit")}>Edit portal profile</a></li>
          <li><a href={resolve("/admin/portals/profiles/disable")}>Disable portal profile</a></li>
        </ul>
      </details>
    {/snippet}

      {#if loading}
        <LoadingState label="Loading portal profiles" />
      {:else if profiles.length === 0}
        <EmptyState title="No portal profiles" description="Create a portal profile to allow portal-owned approval flows." />
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm trellis-table">
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
                    <div class="trellis-identifier font-medium">{profile.portalId}</div>
                    <div class="trellis-identifier text-base-content/60">{profile.entryUrl}</div>
                  </td>
                  <td>
                    <div>{contractLabel(profile.contractId)}</div>
                    <div class="font-mono text-xs text-base-content/60">{profile.contractId}</div>
                  </td>
                  <td class="text-xs text-base-content/70">
                    {#if profile.allowedOrigins?.length}
                      <div class="flex max-w-md flex-wrap gap-1">
                        {#each profile.allowedOrigins as origin (origin)}
                          <span class="badge badge-outline badge-sm font-mono">{origin}</span>
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
                      <StatusBadge label={profile.disabled ? "Disabled" : "Active"} status={profile.disabled ? "offline" : "healthy"} />
                      <span class="text-xs text-base-content/50">Updated {new Date(profile.updatedAt).toLocaleString()}</span>
                    </div>
                  </td>
                  <td class="text-right">
                    <details class="dropdown dropdown-end">
                      <summary class="btn btn-ghost btn-xs">Actions <Icon name="chevronDown" size={12} /></summary>
                      <ul class="menu dropdown-content z-10 mt-2 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
                        <li><a href={resolve(`/admin/portals/profiles/edit?portal=${encodeURIComponent(profile.portalId)}`)}>Edit profile</a></li>
                        {#if profile.disabled}
                          <li class="disabled"><span>Disable profile</span></li>
                        {:else}
                          <li><a href={resolve(`/admin/portals/profiles/disable?portal=${encodeURIComponent(profile.portalId)}`)}>Disable profile</a></li>
                        {/if}
                      </ul>
                    </details>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
  </Panel>

  <Panel title="Portal records" eyebrow="Secondary table">

      {#if loading}
        <LoadingState label="Loading portal records" />
      {:else if portals.length === 0}
        <EmptyState title="No portal records" description="No portal runtime records are currently available." />
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm trellis-table">
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
                  <td class="trellis-identifier font-medium">{portal.portalId}</td>
                  <td>
                    <span class="font-mono text-xs text-base-content/70">{portal.entryUrl}</span>
                  </td>
                  <td>
                    <StatusBadge label={portal.disabled ? "Disabled" : "Active"} status={portal.disabled ? "offline" : "healthy"} />
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="text-xs text-base-content/50">{portals.length} portal{portals.length !== 1 ? "s" : ""}</p>
      {/if}
  </Panel>
</section>
