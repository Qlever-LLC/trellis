<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthClearDevicePortalSelectionInput,
    AuthGetDevicePortalDefaultOutput,
    AuthListDevicePortalSelectionsOutput,
    AuthListDeviceDeploymentsOutput,
    AuthListPortalsOutput,
    AuthSetDevicePortalSelectionInput,
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

  const BUILTIN_OPTION = "__builtin__";
  const INHERIT_OPTION = "__inherit__";

  type PortalRecord = AuthListPortalsOutput["portals"][number];
  type DeploymentRecord = AuthListDeviceDeploymentsOutput["deployments"][number];
  type SelectionRecord = AuthListDevicePortalSelectionsOutput["selections"][number];
  type DefaultPortal = AuthGetDevicePortalDefaultOutput["defaultPortal"];

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let pending = $state(false);
  let error = $state<string | null>(null);
  let feedback = $state<string | null>(null);
  let portals = $state<PortalRecord[]>([]);
  let deployments = $state<DeploymentRecord[]>([]);
  let selections = $state<SelectionRecord[]>([]);
  let defaultPortal = $state<DefaultPortal>({ portalId: null });
  let deploymentId = $state(page.url.searchParams.get("deployment") ?? "");
  let selectionDraft = $state(INHERIT_OPTION);

  const portalById = $derived(new Map(portals.map((portal) => [portal.portalId, portal])));
  const selectionByDeploymentId = $derived(new Map(selections.map((selection) => [selection.deploymentId, selection])));
  const selectedSelection = $derived(deploymentId ? selectionByDeploymentId.get(deploymentId) ?? null : null);

  function optionToPortalId(option: string): string | null {
    return option === BUILTIN_OPTION ? null : option;
  }

  function portalIdToOption(portalId: string | null | undefined): string {
    return portalId ?? BUILTIN_OPTION;
  }

  function portalLabel(portalId: string | null | undefined): string {
    if (portalId == null) return "Built-in portal";
    const portal = portalById.get(portalId);
    if (!portal) return `${portalId} (missing)`;
    return portal.disabled ? `${portal.portalId} (disabled)` : portal.portalId;
  }

  function deploymentContractSummary(deployment: DeploymentRecord): string {
    if (deployment.appliedContracts.length === 0) return `No contracts · review ${deployment.reviewMode ?? "none"}`;
    return `${deployment.appliedContracts.map((entry) => entry.contractId).join(", ")} · review ${deployment.reviewMode ?? "none"}`;
  }

  function syncDraft() {
    selectionDraft = selectedSelection ? portalIdToOption(selectedSelection.portalId) : INHERIT_OPTION;
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
      syncDraft();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function saveSelection() {
    if (!deploymentId) return;

    pending = true;
    error = null;
    feedback = null;
    try {
      if (selectionDraft === INHERIT_OPTION) {
        const response = await trellis.request("Auth.ClearDevicePortalSelection", {
          deploymentId,
        } satisfies AuthClearDevicePortalSelectionInput).take();
        if (isErr(response)) { error = errorMessage(response); return; }
        feedback = `Device policy cleared for ${deploymentId}.`;
        notifications.success(feedback, "Cleared");
      } else {
        const response = await trellis.request("Auth.SetDevicePortalSelection", {
          deploymentId,
          portalId: optionToPortalId(selectionDraft),
        } satisfies AuthSetDevicePortalSelectionInput).take();
        if (isErr(response)) { error = errorMessage(response); return; }
        feedback = `Device policy updated for ${deploymentId}.`;
        notifications.success(feedback, "Updated");
      }
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      pending = false;
    }
  }

  async function clearSelection() {
    if (!deploymentId || !selectedSelection) return;

    pending = true;
    error = null;
    feedback = null;
    try {
      const response = await trellis.request("Auth.ClearDevicePortalSelection", {
        deploymentId,
      } satisfies AuthClearDevicePortalSelectionInput).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      feedback = `Device policy cleared for ${deploymentId}.`;
      notifications.success(feedback, "Cleared");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      pending = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Device portal selection" description="Set or clear a deployment-specific device portal override.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals/devices")}>Back to device policy</a>
    {/snippet}
  </PageToolbar>

  {#if error}<div class="alert alert-error"><span>{error}</span></div>{/if}
  {#if feedback}<div class="alert alert-success"><span>{feedback}</span></div>{/if}

  <Panel title="Deployment override" eyebrow="Device portal">
    {#if loading}
      <LoadingState label="Loading device portal selections" />
    {:else}
      <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); void saveSelection(); }}>
        <label class="form-control gap-1 max-w-2xl">
          <span class="label-text text-xs">Deployment</span>
          <select class="select select-bordered select-sm" bind:value={deploymentId} onchange={syncDraft} required>
            <option value="" disabled>Select a device deployment</option>
            {#each deployments as deployment (deployment.deploymentId)}
              <option value={deployment.deploymentId} disabled={deployment.disabled}>{deployment.deploymentId} · {deploymentContractSummary(deployment)}</option>
            {/each}
          </select>
        </label>

        <label class="form-control gap-1 max-w-2xl">
          <span class="label-text text-xs">Override</span>
          <select class="select select-bordered select-sm" bind:value={selectionDraft}>
            <option value={INHERIT_OPTION}>Use default portal ({portalLabel(defaultPortal.portalId)})</option>
            <option value={BUILTIN_OPTION}>Built-in portal</option>
            {#each portals as portal (portal.portalId)}
              <option value={portal.portalId} disabled={portal.disabled}>{portalLabel(portal.portalId)}</option>
            {/each}
          </select>
        </label>

        <div class="flex flex-wrap items-center gap-2">
          <button type="submit" class="btn btn-outline btn-sm" disabled={!deploymentId || pending}>{pending ? "Saving…" : "Apply Selection"}</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick={() => void clearSelection()} disabled={!deploymentId || !selectedSelection || pending}>{pending ? "Clearing…" : "Clear Selection"}</button>
          <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals/devices")}>Done</a>
        </div>
      </form>
    {/if}
  </Panel>
</section>
