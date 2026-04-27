<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthGetLoginPortalDefaultOutput,
    AuthListInstalledContractsOutput,
    AuthListLoginPortalSelectionsOutput,
    AuthListPortalsOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "../../../../../lib/format";
  import { getTrellis } from "../../../../../lib/trellis";

  type PortalRecord = AuthListPortalsOutput["portals"][number];
  type ContractRecord = AuthListInstalledContractsOutput["contracts"][number];
  type SelectionRecord = AuthListLoginPortalSelectionsOutput["selections"][number];
  type DefaultPortal = AuthGetLoginPortalDefaultOutput["defaultPortal"];

  const trellis = getTrellis();

  let loading = $state(true);
  let error = $state<string | null>(null);

  let portals = $state<PortalRecord[]>([]);
  let contracts = $state<ContractRecord[]>([]);
  let selections = $state<SelectionRecord[]>([]);
  let defaultPortal = $state<DefaultPortal>({ portalId: null });

  const portalById = $derived(new Map(portals.map((portal) => [portal.portalId, portal])));
  const selectionByContractId = $derived(new Map(selections.map((selection) => [selection.contractId, selection])));

  function portalLabel(portalId: string | null | undefined): string {
    if (portalId == null) return "Built-in portal";
    const portal = portalById.get(portalId);
    if (!portal) return `${portalId} (missing)`;
    return portal.disabled ? `${portal.portalId} (disabled)` : portal.portalId;
  }

  function effectivePortalLabel(contractId: string): string {
    const explicit = selectionByContractId.get(contractId);
    const portalId = explicit?.portalId ?? defaultPortal.portalId;
    const source = explicit ? "selection" : "default";
    return `${portalLabel(portalId)} · ${source}`;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [portalRes, contractRes, defaultRes, selectionRes] = await Promise.all([
        trellis.request("Auth.ListPortals", {}).take(),
        trellis.request("Auth.ListInstalledContracts", {}).take(),
        trellis.request("Auth.GetLoginPortalDefault", {}).take(),
        trellis.request("Auth.ListLoginPortalSelections", {}).take(),
      ]);
      if (isErr(portalRes)) { error = errorMessage(portalRes); return; }
      if (isErr(contractRes)) { error = errorMessage(contractRes); return; }
      if (isErr(defaultRes)) { error = errorMessage(defaultRes); return; }
      if (isErr(selectionRes)) { error = errorMessage(selectionRes); return; }

      portals = portalRes.portals ?? [];
      contracts = contractRes.contracts ?? [];
      defaultPortal = defaultRes.defaultPortal ?? { portalId: null };
      selections = selectionRes.selections ?? [];
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
  <PageToolbar title="Login portal policy" description="Select default and contract-specific portals for user sign-in.">
    {#snippet actions()}
      <details class="dropdown dropdown-end">
        <summary class="btn btn-outline btn-sm">Actions <Icon name="chevronDown" size={14} /></summary>
        <ul class="menu dropdown-content z-10 mt-2 w-72 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
          <li><a href={resolve("/admin/portals/login/default")}>Set default login portal</a></li>
          <li><a href={resolve("/admin/portals/login/selection")}>Manage login portal selections</a></li>
        </ul>
      </details>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  <Panel title="Default login portal" eyebrow="Default policy">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="text-sm text-base-content/60">Current default</div>
        <div class="font-medium">{portalLabel(defaultPortal.portalId)}</div>
      </div>
      <a class="btn btn-outline btn-sm" href={resolve("/admin/portals/login/default")}>Change default</a>
    </div>
  </Panel>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading login portal policies" /></Panel>
  {:else if contracts.length === 0}
    <EmptyState title="No installed contracts" description="Install contracts before defining contract-specific login portals." />
  {:else}
    <Panel title="Contract overrides" eyebrow="Primary table">
    <div class="overflow-x-auto">
      <table class="table table-sm trellis-table">
        <thead>
          <tr>
            <th>Contract</th>
            <th>Current</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each contracts as contract (contract.digest)}
            <tr>
              <td>
                <div class="font-medium">{contract.displayName ?? contract.id}</div>
                <div class="font-mono text-xs text-base-content/60">{contract.id}</div>
              </td>
              <td class="text-sm text-base-content/60">{effectivePortalLabel(contract.id)}</td>
              <td class="text-right">
                <details class="dropdown dropdown-end">
                  <summary class="btn btn-ghost btn-xs">Actions <Icon name="chevronDown" size={12} /></summary>
                  <ul class="menu dropdown-content z-10 mt-2 w-60 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
                    <li><a href={resolve(`/admin/portals/login/selection?contract=${encodeURIComponent(contract.id)}`)}>Set selection</a></li>
                    {#if selectionByContractId.get(contract.id)}
                      <li><a href={resolve(`/admin/portals/login/selection?contract=${encodeURIComponent(contract.id)}&mode=clear`)}>Clear selection</a></li>
                    {:else}
                      <li class="disabled"><span>Clear selection</span></li>
                    {/if}
                  </ul>
                </details>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    </Panel>
  {/if}
</section>
