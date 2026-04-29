<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthGetDevicePortalDefaultOutput,
    AuthListDevicePortalSelectionsOutput,
    AuthListDeviceDeploymentsOutput,
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
  type DeploymentRecord = AuthListDeviceDeploymentsOutput["deployments"][number];
  type SelectionRecord = AuthListDevicePortalSelectionsOutput["selections"][number];
  type DefaultPortal = AuthGetDevicePortalDefaultOutput["defaultPortal"];

  const trellis = getTrellis();

  let loading = $state(true);
  let error = $state<string | null>(null);

  let portals = $state<PortalRecord[]>([]);
  let deployments = $state<DeploymentRecord[]>([]);
  let selections = $state<SelectionRecord[]>([]);
  let defaultPortal = $state<DefaultPortal>({ portalId: null });

  const portalById = $derived(new Map(portals.map((portal) => [portal.portalId, portal])));
  const selectionByDeploymentId = $derived(new Map(selections.map((selection) => [selection.deploymentId, selection])));

  function portalLabel(portalId: string | null | undefined): string {
    if (portalId == null) return "Built-in portal";
    const portal = portalById.get(portalId);
    if (!portal) return `${portalId} (missing)`;
    return portal.disabled ? `${portal.portalId} (disabled)` : portal.portalId;
  }

  function effectivePortalLabel(deploymentId: string): string {
    const explicit = selectionByDeploymentId.get(deploymentId);
    const portalId = explicit?.portalId ?? defaultPortal.portalId;
    const source = explicit ? "selection" : "default";
    return `${portalLabel(portalId)} · ${source}`;
  }

  function deploymentContractSummary(deployment: DeploymentRecord): string {
    if (deployment.appliedContracts.length === 0) {
      return `No contracts · review ${deployment.reviewMode ?? "none"}`;
    }

    return `${deployment.appliedContracts.map((entry) => entry.contractId).join(", ")} · review ${deployment.reviewMode ?? "none"}`;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [portalRes, deploymentRes, defaultRes, selectionRes] = await Promise.all([
        trellis.request("Auth.ListPortals", {}).take(),
        trellis.request("Auth.ListDeviceDeployments", {}).take(),
        trellis.request("Auth.GetDevicePortalDefault", {}).take(),
        trellis.request("Auth.ListDevicePortalSelections", {}).take(),
      ]);
      if (isErr(portalRes)) { error = errorMessage(portalRes); return; }
      if (isErr(deploymentRes)) { error = errorMessage(deploymentRes); return; }
      if (isErr(defaultRes)) { error = errorMessage(defaultRes); return; }
      if (isErr(selectionRes)) { error = errorMessage(selectionRes); return; }

      portals = portalRes.portals ?? [];
      deployments = deploymentRes.deployments ?? [];
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
  <PageToolbar title="Device portal policy" description="Select default and deployment-specific portals for device onboarding.">
    {#snippet actions()}
      <details class="dropdown dropdown-end">
        <summary class="btn btn-outline btn-sm">Actions <Icon name="chevronDown" size={14} /></summary>
        <ul class="menu dropdown-content z-10 mt-2 w-72 rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
          <li><a href={resolve("/admin/portals/devices/default")}>Set default device portal</a></li>
          <li><a href={resolve("/admin/portals/devices/selection")}>Manage device portal selections</a></li>
        </ul>
      </details>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  <Panel title="Default device portal" eyebrow="Default policy">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="text-sm text-base-content/60">Current default</div>
        <div class="font-medium">{portalLabel(defaultPortal.portalId)}</div>
      </div>
      <a class="btn btn-outline btn-sm" href={resolve("/admin/portals/devices/default")}>Change default</a>
    </div>
  </Panel>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading device portal policies" /></Panel>
  {:else if deployments.length === 0}
    <EmptyState title="No device deployments" description="Create device deployments before defining deployment-specific portals." />
  {:else}
    <Panel title="Deployment overrides" eyebrow="Primary table">
    <div class="overflow-x-auto">
      <table class="table table-sm trellis-table">
        <thead>
          <tr>
            <th>Deployment</th>
            <th>Current</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each deployments as deployment (deployment.deploymentId)}
            <tr>
              <td>
                <div class="font-medium">{deployment.deploymentId}</div>
                <div class="text-xs text-base-content/60">{deploymentContractSummary(deployment)}</div>
              </td>
              <td class="text-sm text-base-content/60">{effectivePortalLabel(deployment.deploymentId)}</td>
              <td class="text-right">
                <details class="dropdown dropdown-end">
                  <summary class="btn btn-ghost btn-xs">Actions <Icon name="chevronDown" size={12} /></summary>
                  <ul class="menu dropdown-content z-10 mt-2 w-60 rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
                    {#if deployment.disabled}
                      <li class="disabled"><span>Set selection</span></li>
                    {:else}
                      <li><a href={resolve(`/admin/portals/devices/selection?deployment=${encodeURIComponent(deployment.deploymentId)}`)}>Set selection</a></li>
                    {/if}
                    {#if selectionByDeploymentId.get(deployment.deploymentId)}
                      <li><a href={resolve(`/admin/portals/devices/selection?deployment=${encodeURIComponent(deployment.deploymentId)}&mode=clear`)}>Clear selection</a></li>
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
