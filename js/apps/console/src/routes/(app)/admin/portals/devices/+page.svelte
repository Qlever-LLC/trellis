<script lang="ts">
  import type {
    AuthClearDevicePortalSelectionInput,
    AuthGetDevicePortalDefaultOutput,
    AuthListDeviceDeploymentsOutput,
    AuthListDevicePortalSelectionsOutput,
    AuthListPortalsOutput,
    AuthSetDevicePortalDefaultInput,
    AuthSetDevicePortalSelectionInput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { onMount } from "svelte";
  import { errorMessage } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  const BUILTIN_OPTION = "__builtin__";
  const INHERIT_OPTION = "__inherit__";

  type PortalRecord = AuthListPortalsOutput["portals"][number];
  type DeploymentRecord = AuthListDeviceDeploymentsOutput["deployments"][number];
  type SelectionRecord = AuthListDevicePortalSelectionsOutput["selections"][number];
  type DefaultPortal = AuthGetDevicePortalDefaultOutput["defaultPortal"];

  const trellis = getTrellis();
  const notifications = getNotifications();
  type DevicePortalsRequester = {
    request(method: "Auth.ListPortals", input: Record<string, never>): { orThrow(): Promise<AuthListPortalsOutput> };
    request(method: "Auth.ListDeviceDeployments", input: Record<string, never>): { orThrow(): Promise<AuthListDeviceDeploymentsOutput> };
    request(method: "Auth.GetDevicePortalDefault", input: Record<string, never>): { orThrow(): Promise<AuthGetDevicePortalDefaultOutput> };
    request(method: "Auth.ListDevicePortalSelections", input: Record<string, never>): { orThrow(): Promise<AuthListDevicePortalSelectionsOutput> };
    request(method: "Auth.SetDevicePortalDefault", input: AuthSetDevicePortalDefaultInput): { orThrow(): Promise<void> };
    request(method: "Auth.ClearDevicePortalSelection", input: AuthClearDevicePortalSelectionInput): { orThrow(): Promise<void> };
    request(method: "Auth.SetDevicePortalSelection", input: AuthSetDevicePortalSelectionInput): { orThrow(): Promise<void> };
  };
  const devicePortalsSource: object = trellis;
  const devicePortalsRequester = devicePortalsSource as DevicePortalsRequester;

  let loading = $state(true);
  let error = $state<string | null>(null);

  let portals = $state<PortalRecord[]>([]);
  let deployments = $state<DeploymentRecord[]>([]);
  let selections = $state<SelectionRecord[]>([]);
  let defaultPortal = $state<DefaultPortal>({ portalId: null });

  let defaultDraft = $state(BUILTIN_OPTION);
  let selectionDrafts = $state<Record<string, string>>({});

  let defaultPending = $state(false);
  let saveTarget = $state<string | null>(null);
  let clearTarget = $state<string | null>(null);

  const portalById = $derived(new Map(portals.map((portal) => [portal.portalId, portal])));
  const selectionByDeploymentId = $derived(new Map(selections.map((selection) => [selection.deploymentId, selection])));

  function optionToPortalId(option: string): string | null {
    return option === BUILTIN_OPTION ? null : option;
  }

  function portalIdToOption(portalId: string | null | undefined): string {
    return portalId ?? BUILTIN_OPTION;
  }

  function selectionOption(deploymentId: string): string {
    return portalIdToOption(selectionByDeploymentId.get(deploymentId)?.portalId);
  }

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
        devicePortalsRequester.request("Auth.ListPortals", {}).orThrow(),
        devicePortalsRequester.request("Auth.ListDeviceDeployments", {}).orThrow(),
        devicePortalsRequester.request("Auth.GetDevicePortalDefault", {}).orThrow(),
        devicePortalsRequester.request("Auth.ListDevicePortalSelections", {}).orThrow(),
      ]);

      portals = portalRes.portals ?? [];
      deployments = deploymentRes.deployments ?? [];
      defaultPortal = defaultRes.defaultPortal ?? { portalId: null };
      selections = selectionRes.selections ?? [];
      defaultDraft = portalIdToOption(defaultRes.defaultPortal?.portalId);
      selectionDrafts = Object.fromEntries(
        (deploymentRes.deployments ?? []).map((deployment) => {
          const selection = (selectionRes.selections ?? []).find((entry) => entry.deploymentId === deployment.deploymentId);
          return [deployment.deploymentId, selection ? portalIdToOption(selection.portalId) : INHERIT_OPTION];
        }),
      );
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function saveDefault() {
    defaultPending = true;
    error = null;
    try {
      await devicePortalsRequester.request("Auth.SetDevicePortalDefault", {
        portalId: optionToPortalId(defaultDraft),
      } satisfies AuthSetDevicePortalDefaultInput).orThrow();
      notifications.success("Default device portal updated.", "Updated");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      defaultPending = false;
    }
  }

  async function saveSelection(deploymentId: string) {
    saveTarget = deploymentId;
    error = null;
    try {
      const option = selectionDrafts[deploymentId] ?? INHERIT_OPTION;
      if (option === INHERIT_OPTION) {
        await devicePortalsRequester.request("Auth.ClearDevicePortalSelection", {
          deploymentId,
        } satisfies AuthClearDevicePortalSelectionInput).orThrow();
        notifications.success(`Device policy cleared for ${deploymentId}.`, "Cleared");
      } else {
        await devicePortalsRequester.request("Auth.SetDevicePortalSelection", {
          deploymentId,
          portalId: optionToPortalId(option),
        } satisfies AuthSetDevicePortalSelectionInput).orThrow();
        notifications.success(`Device policy updated for ${deploymentId}.`, "Updated");
      }
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saveTarget = null;
    }
  }

  async function clearSelection(deploymentId: string) {
    if (!selectionByDeploymentId.get(deploymentId)) return;
    if (!window.confirm(`Clear the device portal override for ${deploymentId}?`)) return;
    clearTarget = deploymentId;
    error = null;
    try {
      await devicePortalsRequester.request("Auth.ClearDevicePortalSelection", {
        deploymentId,
      } satisfies AuthClearDevicePortalSelectionInput).orThrow();
      notifications.success(`Device policy cleared for ${deploymentId}.`, "Cleared");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      clearTarget = null;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <div class="flex items-center justify-end">
    <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
  </div>

  <div class="card border border-base-300 bg-base-100">
    <div class="card-body gap-4">
      <div>
        <h2 class="card-title text-base">Default device portal</h2>
        <p class="text-sm text-base-content/60">Choose the portal used when a device deployment does not have an explicit portal policy.</p>
      </div>

      <form class="flex flex-col gap-3 md:flex-row md:items-end" onsubmit={(event) => { event.preventDefault(); void saveDefault(); }}>
        <label class="form-control gap-1 md:min-w-96">
          <span class="label-text text-xs">Default portal</span>
          <select class="select select-bordered select-sm" bind:value={defaultDraft}>
            <option value={BUILTIN_OPTION}>Built-in portal</option>
            {#each portals as portal (portal.portalId)}
              <option value={portal.portalId} disabled={portal.disabled}>{portalLabel(portal.portalId)}</option>
            {/each}
          </select>
        </label>

        <div class="text-sm text-base-content/60 md:pb-2">Current: {portalLabel(defaultPortal.portalId)}</div>

        <button type="submit" class="btn btn-primary btn-sm" disabled={defaultPending || defaultDraft === portalIdToOption(defaultPortal.portalId)}>
          {defaultPending ? "Saving…" : "Save Default"}
        </button>
      </form>
    </div>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
  {:else if deployments.length === 0}
    <p class="text-sm text-base-content/60">No device deployments found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Deployment</th>
            <th>Current</th>
            <th>Override</th>
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
              <td>
                <select class="select select-bordered select-xs w-full max-w-72" bind:value={selectionDrafts[deployment.deploymentId]}>
                  <option value={INHERIT_OPTION}>Use default portal</option>
                  <option value={BUILTIN_OPTION}>Built-in portal</option>
                  {#each portals as portal (portal.portalId)}
                    <option value={portal.portalId} disabled={portal.disabled}>{portalLabel(portal.portalId)}</option>
                  {/each}
                </select>
              </td>
              <td class="text-right">
                <div class="flex justify-end gap-2">
                  <button
                    class="btn btn-primary btn-xs"
                    onclick={() => saveSelection(deployment.deploymentId)}
                    disabled={saveTarget === deployment.deploymentId || clearTarget === deployment.deploymentId || selectionDrafts[deployment.deploymentId] === (selectionByDeploymentId.get(deployment.deploymentId) ? selectionOption(deployment.deploymentId) : INHERIT_OPTION) || deployment.disabled}
                  >
                    {saveTarget === deployment.deploymentId ? "Saving…" : "Apply"}
                  </button>

                  <button
                    class="btn btn-ghost btn-xs"
                    onclick={() => clearSelection(deployment.deploymentId)}
                    disabled={clearTarget === deployment.deploymentId || saveTarget === deployment.deploymentId || !selectionByDeploymentId.get(deployment.deploymentId)}
                  >
                    {clearTarget === deployment.deploymentId ? "Clearing…" : "Clear"}
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
