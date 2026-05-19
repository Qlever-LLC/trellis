<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthEnvelopeExpansionsListResponse,
    AuthEnvelopesGetResponse,
    AuthEnvelopesListResponse,
    DeploymentEnvelope,
  } from "@qlever-llc/trellis/auth";
  import type { AuthCapabilitiesListOutput } from "@qlever-llc/trellis/sdk/auth";
  import { afterNavigate, goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import InlineMetricsStrip from "$lib/components/InlineMetricsStrip.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import {
    boundaryCounts,
    chooseSelectedExpansionRequest,
    chooseSelectedDeployment,
    deltaCapabilityRows,
    deltaContractRows,
    deltaResourceRows,
    deltaSurfaceRows,
    deviceRuntimeDeployments,
    EnvelopeSelectionGuard,
    envelopeRows,
    expansionRequestRows,
    formatBindingTarget,
    livenessRows,
    serviceRuntimeDeployments,
    type RuntimeDeployment,
  } from "$lib/envelope_console";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type DetailTab = "liveness" | "requests" | "resources" | "grants" | "manual";
  type DeploymentGrantOverride = AuthEnvelopesGetResponse["grantOverrides"][number];
  type GrantIdentityKind = DeploymentGrantOverride["identityKind"];
  type CapabilityView = AuthCapabilitiesListOutput["capabilities"][number];
  type CapabilitySection = {
    key: string;
    title: string;
    subtitle: string | null;
    capabilities: CapabilityView[];
  };
  type GrantOverrideMutationInput = {
    deploymentId: string;
    overrides: DeploymentGrantOverride[];
  };
  type GrantOverrideRpcClient = {
    request(
      subject: "Auth.Envelopes.GrantOverrides.Put" | "Auth.Envelopes.GrantOverrides.Remove",
      input: GrantOverrideMutationInput,
    ): { take(): Promise<unknown> };
  };

  const detailTabs: DetailTab[] = ["liveness", "requests", "resources", "grants", "manual"];
  const grantIdentityKinds: GrantIdentityKind[] = ["web", "cli", "native", "device-user", "any"];

  const trellis = getTrellis();
  const grantOverrideRpc = trellis as GrantOverrideRpcClient;

  let loading = $state(true);
  let detailLoading = $state(false);
  let expanding = $state(false);
  let approvingRequestId = $state<string | null>(null);
  let rejectingRequestId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let livenessError = $state<string | null>(null);
  let expandError = $state<string | null>(null);
  let expandResult = $state<string | null>(null);
  let grantError = $state<string | null>(null);
  let grantResult = $state<string | null>(null);
  let grantSaving = $state(false);
  let removingGrantKey = $state<string | null>(null);
  let capabilitiesError = $state<string | null>(null);
  let search = $state("");
  let reviewSearch = $state("");
  let rejectionReason = $state("");
  let activeDetailTab = $state<DetailTab>("liveness");
  let contractJson = $state("");
  let expectedDigest = $state("");
  let grantIdentityKind = $state<GrantIdentityKind>("any");
  let grantContractId = $state("");
  let grantOrigin = $state("");
  let grantSessionPublicKey = $state("");
  let grantDevicePublicKey = $state("");
  let manualGrantCapability = $state("");
  let selectedGrantCapabilities = $state<string[]>([]);
  let envelopes = $state.raw<DeploymentEnvelope[]>([]);
  let expansionRequests = $state.raw<AuthEnvelopeExpansionsListResponse["requests"]>([]);
  let runtimeDeployments = $state.raw<RuntimeDeployment[]>([]);
  let capabilities = $state<CapabilityView[]>([]);
  let selectedDeploymentId = $state<string | null>(null);
  let selectedRequestId = $state<string | null>(null);
  let detail = $state<AuthEnvelopesGetResponse | null>(null);
  const selectionGuard = new EnvelopeSelectionGuard();

  const rows = $derived(envelopeRows(envelopes));
  const filteredRows = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      [row.deploymentId, row.kind, row.status].some((value) => value.toLowerCase().includes(term))
    );
  });
  const selectedEnvelope = $derived(detail?.envelope ?? null);
  const counts = $derived(selectedEnvelope ? boundaryCounts(selectedEnvelope.boundary) : null);
  const reviewRows = $derived.by(() => {
    const rows = expansionRequestRows(expansionRequests).toSorted((a, b) => {
      if (a.state === b.state) return b.createdAt.localeCompare(a.createdAt);
      if (a.state === "pending") return -1;
      if (b.state === "pending") return 1;
      return a.state.localeCompare(b.state);
    });
    const term = reviewSearch.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => row.searchableText.includes(term));
  });
  const selectedRequest = $derived(
    expansionRequests.find((request) => request.requestId === selectedRequestId) ?? null,
  );
  const selectedRequestCounts = $derived(selectedRequest ? boundaryCounts(selectedRequest.delta) : null);
  const selectedDeltaContracts = $derived(selectedRequest ? deltaContractRows(selectedRequest.delta) : []);
  const selectedDeltaSurfaces = $derived(selectedRequest ? deltaSurfaceRows(selectedRequest.delta) : []);
  const selectedDeltaResources = $derived(selectedRequest ? deltaResourceRows(selectedRequest.delta) : []);
  const selectedDeltaCapabilities = $derived(selectedRequest ? deltaCapabilityRows(selectedRequest.delta) : []);
  const requestRows = $derived(detail ? expansionRequestRows(detail.expansionRequests) : []);
  const grantOverrides = $derived(detail?.grantOverrides ?? []);
  const capabilitySections = $derived.by(() => {
    const sections: CapabilitySection[] = [];
    for (const capability of capabilities) {
      const key = capabilitySectionKey(capability);
      const existing = sections.find((section) => section.key === key);
      if (existing) {
        existing.capabilities.push(capability);
      } else {
        sections.push({
          key,
          title: capabilitySectionTitle(capability),
          subtitle: capabilitySectionSubtitle(capability),
          capabilities: [capability],
        });
      }
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
  const liveRows = $derived(
    selectedEnvelope
      ? livenessRows(selectedEnvelope.boundary, runtimeDeployments, selectedEnvelope.deploymentId)
      : [],
  );
  const metrics = $derived([
    { label: "Envelopes", value: envelopes.length },
    { label: "Active", value: envelopes.filter((envelope) => !envelope.disabled).length },
    { label: "Pending Reviews", value: expansionRequests.filter((request) => request.state === "pending").length },
    { label: "Resources", value: detail?.resourceBindings.length ?? 0 },
  ]);

  type RuntimeDeploymentLoad = {
    deployments: RuntimeDeployment[];
    error: string | null;
  };

  function tabPanelId(tab: DetailTab): string {
    return `authority-${tab}-panel`;
  }

  function tabButtonId(tab: DetailTab): string {
    return `authority-${tab}-tab`;
  }

  function focusDetailTab(tab: DetailTab): void {
    document.getElementById(tabButtonId(tab))?.focus();
  }

  function selectDetailTab(tab: DetailTab): void {
    activeDetailTab = tab;
    focusDetailTab(tab);
  }

  function handleTabKeydown(event: KeyboardEvent, tab: DetailTab): void {
    const index = detailTabs.indexOf(tab);
    if (index === -1) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectDetailTab(detailTabs[(index + 1) % detailTabs.length]);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectDetailTab(detailTabs[(index - 1 + detailTabs.length) % detailTabs.length]);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectDetailTab(detailTabs[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      selectDetailTab(detailTabs[detailTabs.length - 1]);
    }
  }

  function statusVariant(status: string): "healthy" | "offline" {
    return status === "Active" ? "healthy" : "offline";
  }

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

  function localCapabilityKey(key: string): string {
    return key.includes("::") ? key.split("::").slice(1).join("::") : key;
  }

  function trimmedOptional(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function uniqueCapabilities(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
  }

  function grantOverrideKey(override: DeploymentGrantOverride): string {
    return [
      override.identityKind,
      override.contractId ?? "*",
      override.origin ?? "*",
      override.sessionPublicKey ?? "*",
      override.devicePublicKey ?? "*",
      override.capability,
    ].join("|");
  }

  function sameGrantOverride(left: DeploymentGrantOverride, right: DeploymentGrantOverride): boolean {
    return grantOverrideKey(left) === grantOverrideKey(right);
  }

  function buildGrantOverrides(): DeploymentGrantOverride[] {
    const deploymentId = selectedDeploymentId;
    if (!deploymentId) return [];
    const capabilities = uniqueCapabilities([...selectedGrantCapabilities, manualGrantCapability]);
    return capabilities.map((capability) => ({
      deploymentId,
      identityKind: grantIdentityKind,
      contractId: trimmedOptional(grantContractId),
      origin: trimmedOptional(grantOrigin),
      sessionPublicKey: trimmedOptional(grantSessionPublicKey),
      devicePublicKey: trimmedOptional(grantDevicePublicKey),
      capability,
    }));
  }

  function resetGrantForm(): void {
    grantIdentityKind = "any";
    grantContractId = "";
    grantOrigin = "";
    grantSessionPublicKey = "";
    grantDevicePublicKey = "";
    manualGrantCapability = "";
    selectedGrantCapabilities = [];
  }

  async function updateDeploymentUrl(deploymentId: string, replaceState = false): Promise<void> {
    await goto(resolve(`/admin/envelopes?deployment=${encodeURIComponent(deploymentId)}`), {
      keepFocus: true,
      noScroll: true,
      replaceState,
    });
  }

  async function selectDeploymentFromUrl(replaceInvalidSelection = false, forceReload = false): Promise<void> {
    if (loading) return;
    const nextSelection = chooseSelectedDeployment(envelopes, page.url.searchParams.get("deployment"));
    if (!nextSelection) {
      selectedDeploymentId = null;
      detail = null;
      runtimeDeployments = [];
      livenessError = null;
      return;
    }

    if (replaceInvalidSelection && page.url.searchParams.get("deployment") !== nextSelection) {
      await updateDeploymentUrl(nextSelection, true);
      return;
    }

    if (forceReload || selectedDeploymentId !== nextSelection || !detail) {
      await selectEnvelope(nextSelection);
    }
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [envelopeResponse, expansionResponse, capabilitiesResponse] = await Promise.all([
        trellis.request("Auth.Envelopes.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.EnvelopeExpansions.List", { state: "pending", limit: 500, offset: 0 }).take(),
        trellis.request("Auth.Capabilities.List", { limit: 500, offset: 0 }).take(),
      ]);
      if (isErr(envelopeResponse)) { error = errorMessage(envelopeResponse); detail = null; runtimeDeployments = []; return; }
      if (isErr(expansionResponse)) { error = errorMessage(expansionResponse); detail = null; runtimeDeployments = []; return; }
      if (isErr(capabilitiesResponse)) {
        capabilitiesError = errorMessage(capabilitiesResponse);
      } else {
        capabilitiesError = null;
        capabilities = (capabilitiesResponse.capabilities ?? []).slice().sort((left, right) => left.key.localeCompare(right.key));
      }
      const envelopeValue = envelopeResponse as AuthEnvelopesListResponse;
      const expansionValue = expansionResponse as AuthEnvelopeExpansionsListResponse;
      envelopes = envelopeValue.envelopes;
      expansionRequests = expansionValue.requests;
      selectedRequestId = chooseSelectedExpansionRequest(expansionRequests, selectedRequestId);
      loading = false;
      await selectDeploymentFromUrl(true, true);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function selectEnvelope(deploymentId: string) {
    const requestToken = selectionGuard.begin(deploymentId);
    selectedDeploymentId = deploymentId;
    detailLoading = true;
    error = null;
    livenessError = null;
    expandResult = null;
    runtimeDeployments = [];
    try {
      const [response, runtime] = await Promise.all([
        trellis.request("Auth.Envelopes.Get", { deploymentId }).take(),
        loadRuntimeDeployments(deploymentId),
      ]);
      if (!selectionGuard.shouldCommit(deploymentId, requestToken)) return;
      if (isErr(response)) {
        error = errorMessage(response);
        detail = null;
        runtimeDeployments = [];
        livenessError = null;
        return;
      }
      detail = response as AuthEnvelopesGetResponse;
      runtimeDeployments = runtime.deployments;
      livenessError = runtime.error;
    } catch (e) {
      if (!selectionGuard.shouldCommit(deploymentId, requestToken)) return;
      error = errorMessage(e);
      detail = null;
      runtimeDeployments = [];
      livenessError = null;
    } finally {
      if (selectionGuard.shouldCommit(deploymentId, requestToken)) {
        detailLoading = false;
      }
    }
  }

  async function loadRuntimeDeployments(deploymentId: string): Promise<RuntimeDeploymentLoad> {
    try {
      const envelope = envelopes.find((entry) => entry.deploymentId === deploymentId);
      if (!envelope) return { deployments: [], error: null };
      if (envelope.kind === "service") {
        const response = await trellis.request("Auth.ServiceInstances.List", { limit: 500, offset: 0 }).take();
        if (isErr(response)) return { deployments: [], error: errorMessage(response) };
        const value = response as { instances: Array<{ deploymentId: string; disabled: boolean }> };
        return { deployments: serviceRuntimeDeployments(value.instances), error: null };
      }
      if (envelope.kind === "device") {
        const response = await trellis.request("Auth.Devices.List", { limit: 500, offset: 0 }).take();
        if (isErr(response)) return { deployments: [], error: errorMessage(response) };
        const value = response as {
          instances: Array<{
            deploymentId: string;
            state: "registered" | "activated" | "revoked" | "disabled";
            currentContractId?: string;
            currentContractDigest?: string;
          }>;
        };
        return { deployments: deviceRuntimeDeployments(value.instances), error: null };
      }
    } catch (e) {
      return { deployments: [], error: errorMessage(e) };
    }
    return { deployments: [], error: null };
  }

  function selectEnvelopeRow(deploymentId: string): void {
    void updateDeploymentUrl(deploymentId);
  }

  function selectReviewRequest(requestId: string): void {
    selectedRequestId = requestId;
    rejectionReason = "";
    const request = expansionRequests.find((entry) => entry.requestId === requestId);
    if (request) {
      selectedDeploymentId = request.deploymentId;
      void updateDeploymentUrl(request.deploymentId);
    }
  }

  async function refreshAfterDecision(deploymentId: string): Promise<void> {
    await load();
    if (selectedDeploymentId === deploymentId) {
      await selectEnvelope(deploymentId);
    }
  }

  async function expandSelectedEnvelope() {
    if (!selectedDeploymentId) return;
    expandError = null;
    expandResult = null;
    grantError = null;
    grantResult = null;
    expanding = true;
    try {
      const contract = JSON.parse(contractJson) as Record<string, unknown>;
      const response = await trellis.request("Auth.Envelopes.Expand", {
        deploymentId: selectedDeploymentId,
        contract,
        expectedDigest,
      }).take();
      if (isErr(response)) { expandError = errorMessage(response); return; }
      expandResult = "Deployment authority expanded from contract evidence.";
      contractJson = "";
      expectedDigest = "";
      await load();
    } catch (e) {
      expandError = errorMessage(e);
    } finally {
      expanding = false;
    }
  }

  async function approveExpansionRequest(requestId: string) {
    const request = expansionRequests.find((entry) => entry.requestId === requestId);
    expandError = null;
    expandResult = null;
    approvingRequestId = requestId;
    try {
      const response = await trellis.request("Auth.EnvelopeExpansions.Approve", {
        requestId,
      }).take();
      if (isErr(response)) { expandError = errorMessage(response); return; }
      expandResult = `Approved expansion request ${requestId}.`;
      await refreshAfterDecision(request?.deploymentId ?? selectedDeploymentId ?? "");
    } catch (e) {
      expandError = errorMessage(e);
    } finally {
      approvingRequestId = null;
    }
  }

  async function rejectExpansionRequest(requestId: string) {
    const request = expansionRequests.find((entry) => entry.requestId === requestId);
    const reason = rejectionReason.trim();
    if (!reason) {
      expandError = "A rejection reason is required.";
      return;
    }
    expandError = null;
    expandResult = null;
    rejectingRequestId = requestId;
    try {
      const response = await trellis.request("Auth.EnvelopeExpansions.Reject", {
        requestId,
        reason,
      }).take();
      if (isErr(response)) { expandError = errorMessage(response); return; }
      expandResult = `Rejected expansion request ${requestId}.`;
      rejectionReason = "";
      await refreshAfterDecision(request?.deploymentId ?? selectedDeploymentId ?? "");
    } catch (e) {
      expandError = errorMessage(e);
    } finally {
      rejectingRequestId = null;
    }
  }

  async function saveGrantOverrides() {
    if (!selectedDeploymentId || !detail) return;
    const newOverrides = buildGrantOverrides();
    if (newOverrides.length === 0) {
      grantError = "Select or enter at least one capability.";
      return;
    }

    const overrides = [...detail.grantOverrides];
    for (const override of newOverrides) {
      if (!overrides.some((existing) => sameGrantOverride(existing, override))) overrides.push(override);
    }

    grantSaving = true;
    grantError = null;
    grantResult = null;
    try {
      const response = await grantOverrideRpc.request("Auth.Envelopes.GrantOverrides.Put", {
        deploymentId: selectedDeploymentId,
        overrides,
      }).take();
      if (isErr(response)) { grantError = errorMessage(response); return; }
      grantResult = `Saved ${newOverrides.length} grant override${newOverrides.length === 1 ? "" : "s"}.`;
      resetGrantForm();
      await selectEnvelope(selectedDeploymentId);
    } catch (e) {
      grantError = errorMessage(e);
    } finally {
      grantSaving = false;
    }
  }

  async function removeGrantOverride(override: DeploymentGrantOverride) {
    if (!selectedDeploymentId) return;
    const key = grantOverrideKey(override);
    removingGrantKey = key;
    grantError = null;
    grantResult = null;
    try {
      const response = await grantOverrideRpc.request("Auth.Envelopes.GrantOverrides.Remove", {
        deploymentId: selectedDeploymentId,
        overrides: [override],
      }).take();
      if (isErr(response)) { grantError = errorMessage(response); return; }
      grantResult = "Removed grant override.";
      await selectEnvelope(selectedDeploymentId);
    } catch (e) {
      grantError = errorMessage(e);
    } finally {
      removingGrantKey = null;
    }
  }

  afterNavigate(() => {
    void selectDeploymentFromUrl(true);
  });

  onMount(() => { void load(); });
</script>

<section class="space-y-4">
  <PageToolbar title="Deployment Authority" description="Review each deployment's authority boundary, expansion requests, resources, API availability, and runtime liveness.">
    {#snippet actions()}
      <label class="sr-only" for="envelope-search">Search deployment authority</label>
      <input id="envelope-search" class="input input-bordered input-sm w-64" placeholder="Search deployment authority" bind:value={search} />
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading} aria-label="Refresh deployment authority list and selected detail">Refresh</button>
    {/snippet}
  </PageToolbar>

  <InlineMetricsStrip metrics={metrics} />

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <LoadingState label="Loading deployment envelopes" />
  {:else}
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
      <Panel title="Pending Authority Reviews" eyebrow="Primary review queue" class="min-w-0">
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <label class="sr-only" for="review-search">Search authority review requests</label>
          <input id="review-search" class="input input-bordered input-sm w-full max-w-sm" placeholder="Search reviews, deployments, contracts, deltas" bind:value={reviewSearch} />
          <span class="badge badge-outline badge-sm">{reviewRows.length} shown</span>
        </div>
        {#if reviewRows.length === 0}
          <EmptyState title="No expansion review requests" description="Envelope expansion requests appear here without selecting a deployment first." />
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-sm trellis-table min-w-[880px] table-fixed">
              <colgroup><col class="w-[22%]" /><col class="w-[20%]" /><col class="w-[10%]" /><col class="w-[18%]" /><col class="w-[20%]" /><col class="w-[10%]" /></colgroup>
              <thead><tr><th>Request</th><th>Deployment</th><th>State</th><th>Requester</th><th>Delta counts</th><th>Created</th></tr></thead>
              <tbody>
                {#each reviewRows as row (row.requestId)}
                  <tr class={selectedRequestId === row.requestId ? "bg-base-200/70" : ""}>
                    <td><button class="btn btn-ghost btn-xs trellis-identifier" onclick={() => selectReviewRequest(row.requestId)} aria-label={`Review expansion request ${row.requestId}`}>{row.requestId}</button></td>
                    <td class="trellis-identifier">{row.deploymentId}</td>
                    <td><span class={['badge badge-xs', row.state === 'pending' ? 'badge-warning' : row.state === 'approved' ? 'badge-success' : 'badge-neutral']}>{row.state}</span></td>
                    <td><span class="badge badge-outline badge-xs">{row.requestedByKind}</span></td>
                    <td class="text-xs text-base-content/65">{row.requiredContracts + row.optionalContracts} contracts · {row.requiredSurfaces + row.optionalSurfaces} surfaces · {row.resources} resources · {row.capabilities} capabilities</td>
                    <td class="text-xs text-base-content/60">{formatDate(row.createdAt)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </Panel>

      <Panel title="Review Request Detail" eyebrow="Selected request" class="min-w-0">
        {#if selectedRequest && selectedRequestCounts}
          <div class="space-y-3 text-sm">
            <div class="grid grid-cols-2 gap-2">
              <div><span class="text-base-content/50">Request:</span> <span class="trellis-identifier">{selectedRequest.requestId}</span></div>
              <div><span class="text-base-content/50">State:</span> <span class="badge badge-outline badge-xs">{selectedRequest.state}</span></div>
              <div><span class="text-base-content/50">Deployment:</span> <span class="trellis-identifier">{selectedRequest.deploymentId}</span></div>
              <div><span class="text-base-content/50">Requester:</span> {selectedRequest.requestedByKind}</div>
              <div><span class="text-base-content/50">Contract:</span> <span class="trellis-identifier">{selectedRequest.contractId}</span></div>
              <div><span class="text-base-content/50">Digest:</span> <span class="trellis-identifier">{selectedRequest.contractDigest}</span></div>
              <div><span class="text-base-content/50">Created:</span> {formatDate(selectedRequest.createdAt)}</div>
              <div><span class="text-base-content/50">Decided:</span> {selectedRequest.decidedAt ? formatDate(selectedRequest.decidedAt) : "Pending"}</div>
            </div>
            <div class="rounded-box border border-base-300 bg-base-200/40 p-2">
              <div class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Requester metadata</div>
              <pre class="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(selectedRequest.requestedBy, null, 2)}</pre>
            </div>

            <div class="grid grid-cols-2 gap-2 text-xs">
              <span>Contracts: {selectedRequestCounts.requiredContracts} required / {selectedRequestCounts.optionalContracts} optional</span>
              <span>Surfaces: {selectedRequestCounts.requiredSurfaces} required / {selectedRequestCounts.optionalSurfaces} optional</span>
              <span>Resources: {selectedRequestCounts.requiredResources} required / {selectedRequestCounts.optionalResources} optional</span>
              <span>Capabilities: {selectedRequestCounts.capabilities}</span>
            </div>

            <div class="space-y-2">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Exact delta</h3>
              <div class="overflow-x-auto">
                <table class="table table-xs trellis-table">
                  <thead><tr><th>Type</th><th>Contract / Kind</th><th>Name / Alias / Capability</th><th>Action</th><th>Availability</th></tr></thead>
                  <tbody>
                    {#each selectedDeltaContracts as contract (contract.id)}
                      <tr><td>contract</td><td class="trellis-identifier">{contract.contractId}</td><td>n/a</td><td>n/a</td><td><span class="badge badge-outline badge-xs">{contract.availability}</span></td></tr>
                    {/each}
                    {#each selectedDeltaSurfaces as surface (surface.id)}
                      <tr><td>surface</td><td><div class="trellis-identifier">{surface.contractId}</div><div class="text-base-content/50">{surface.kind}</div></td><td class="trellis-identifier">{surface.name}</td><td>{surface.action}</td><td><span class="badge badge-outline badge-xs">{surface.availability}</span></td></tr>
                    {/each}
                    {#each selectedDeltaResources as resource (resource.id)}
                      <tr><td>resource</td><td>{resource.kind}</td><td class="trellis-identifier">{resource.alias}</td><td>n/a</td><td><span class="badge badge-outline badge-xs">{resource.availability}</span></td></tr>
                    {/each}
                    {#each selectedDeltaCapabilities as capability (capability.id)}
                      <tr><td>capability</td><td>n/a</td><td class="trellis-identifier">{capability.capability}</td><td>grant</td><td>n/a</td></tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>

            {#if selectedRequest.decisionReason}
              <div class="text-sm text-base-content/65"><span class="text-base-content/50">Decision reason:</span> {selectedRequest.decisionReason}</div>
            {/if}

            <div class="divider my-2"></div>
            <div class="grid gap-2 md:grid-cols-[1fr_auto_auto]">
              <label class="sr-only" for="rejection-reason">Rejection reason</label>
              <input id="rejection-reason" class="input input-bordered input-sm" placeholder="Reason required for rejection" bind:value={rejectionReason} disabled={selectedRequest.state !== "pending"} />
              <button class="btn btn-outline btn-sm" onclick={() => rejectExpansionRequest(selectedRequest.requestId)} disabled={selectedRequest.state !== "pending" || !rejectionReason.trim() || rejectingRequestId === selectedRequest.requestId} aria-label={`Reject expansion request ${selectedRequest.requestId}`}>{rejectingRequestId === selectedRequest.requestId ? "Rejecting..." : "Reject"}</button>
              <button class="btn btn-primary btn-sm" onclick={() => approveExpansionRequest(selectedRequest.requestId)} disabled={selectedRequest.state !== "pending" || approvingRequestId === selectedRequest.requestId} aria-label={`Approve expansion request ${selectedRequest.requestId}`}>{approvingRequestId === selectedRequest.requestId ? "Approving..." : "Approve"}</button>
            </div>
            {#if expandError}<div class="alert alert-error text-sm"><span>{expandError}</span></div>{/if}
            {#if expandResult}<div class="alert alert-success text-sm"><span>{expandResult}</span></div>{/if}
          </div>
        {:else}
          <EmptyState title="Select a review request" description="Choose a request from the queue to inspect exact boundary delta and approve or reject it." />
        {/if}
      </Panel>
    </div>

    <div class="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]">
      <Panel title="Deployment Authority List" eyebrow="Secondary deployment detail" class="min-w-0">
        {#if filteredRows.length === 0}
          <EmptyState title="No deployment authority" description="Authority boundaries appear after a service, device, app, CLI, or identity scope is modeled." />
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-sm trellis-table min-w-[760px] table-fixed">
              <colgroup><col class="w-[34%]" /><col class="w-[12%]" /><col class="w-[12%]" /><col class="w-[18%]" /><col class="w-[12%]" /><col class="w-[12%]" /></colgroup>
              <thead><tr><th>Deployment</th><th>Kind</th><th>Status</th><th>Boundary</th><th>Resources</th><th>Updated</th></tr></thead>
              <tbody>
                {#each filteredRows as row (row.deploymentId)}
                  <tr class={selectedDeploymentId === row.deploymentId ? "bg-base-200/70" : ""}>
                    <td><button class="btn btn-ghost btn-xs trellis-identifier" onclick={() => selectEnvelopeRow(row.deploymentId)}>{row.deploymentId}</button></td>
                    <td><span class="badge badge-outline badge-xs">{row.kind}</span></td>
                    <td><StatusBadge label={row.status} status={statusVariant(row.status)} /></td>
                    <td class="text-xs text-base-content/60">{row.requiredContracts} req / {row.optionalContracts} opt · {row.surfaces} surfaces</td>
                    <td class="tabular-nums">{row.resources}</td>
                    <td class="text-xs text-base-content/60">{formatDate(row.updatedAt)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </Panel>

      <div class="space-y-4 min-w-0">
        <Panel title="Selected Authority" eyebrow="Secondary">
          <div class="tabs tabs-bordered mb-3" role="tablist" aria-label="Selected authority detail sections">
            {#each detailTabs as tab (tab)}
              <button
                id={tabButtonId(tab)}
                class={["tab capitalize", activeDetailTab === tab && "tab-active"]}
                type="button"
                role="tab"
                aria-selected={activeDetailTab === tab}
                aria-controls={tabPanelId(tab)}
                tabindex={activeDetailTab === tab ? 0 : -1}
                onclick={() => selectDetailTab(tab)}
                onkeydown={(event) => handleTabKeydown(event, tab)}
              >{tab}</button>
            {/each}
          </div>

          {#if detailLoading}
            <LoadingState label="Loading deployment authority detail" class="min-h-32" />
          {:else if selectedEnvelope && counts}
            <div class="mb-3 grid grid-cols-2 gap-2 text-sm">
              <div><span class="text-base-content/50">Deployment:</span> <span class="trellis-identifier">{selectedEnvelope.deploymentId}</span></div>
              <div><span class="text-base-content/50">Kind:</span> {selectedEnvelope.kind}</div>
              <div><span class="text-base-content/50">Contracts:</span> {counts.requiredContracts} required / {counts.optionalContracts} optional</div>
              <div><span class="text-base-content/50">Surfaces:</span> {counts.requiredSurfaces} required / {counts.optionalSurfaces} optional</div>
            </div>

            {#if activeDetailTab === "liveness"}
              <div id={tabPanelId("liveness")} role="tabpanel" aria-labelledby={tabButtonId("liveness")} tabindex="0">
                {#if livenessError}
                  <div class="alert alert-warning text-sm">
                    <span>Runtime liveness could not be loaded: {livenessError}</span>
                  </div>
                {:else if liveRows.length === 0}
                  <EmptyState title="No authority surfaces" description="Surfaces appear when contracts contribute RPCs, operations, events, or feeds to the deployment authority boundary." />
                {:else}
                  <div class="overflow-x-auto">
                  <table class="table table-xs trellis-table">
                    <thead><tr><th>Surface</th><th>Kind</th><th>Action</th><th>Availability</th><th>Runtime</th></tr></thead>
                    <tbody>
                      {#each liveRows as row (row.id)}
                        <tr>
                          <td><div class="trellis-identifier">{row.surface}</div><div class="text-xs text-base-content/50">{row.contractId}</div></td>
                          <td>{row.kind}</td>
                          <td>{row.action}</td>
                          <td><span class="badge badge-outline badge-xs">{row.availability}</span></td>
                          <td><span class={["badge badge-xs", row.runtime === "live" ? "badge-success" : row.runtime === "disabled" ? "badge-neutral" : "badge-warning"]}>{row.runtime}</span></td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                  </div>
                {/if}
              </div>
            {:else if activeDetailTab === "requests"}
              <div id={tabPanelId("requests")} role="tabpanel" aria-labelledby={tabButtonId("requests")} tabindex="0">
                {#if requestRows.length === 0}
                  <EmptyState title="No requests" description="Waiting services or devices create deployment authority expansion requests when their required boundary exceeds the deployment authority." />
                {:else}
                  <div class="overflow-x-auto">
                  <table class="table table-xs trellis-table">
                    <thead><tr><th>Request</th><th>State</th><th>Contract</th><th>Delta</th><th>Created</th><th></th></tr></thead>
                    <tbody>
                      {#each requestRows as request (request.requestId)}
                        <tr>
                          <td class="trellis-identifier">{request.requestId}</td>
                          <td><span class="badge badge-outline badge-xs">{request.state}</span></td>
                          <td class="trellis-identifier">{request.contractId}</td>
                          <td>{request.requiredContracts} contracts · {request.optionalSurfaces} optional surfaces · {request.resources} resources · {request.capabilities} capabilities</td>
                          <td>{formatDate(request.createdAt)}</td>
                          <td>{#if request.state === "pending"}<button class="btn btn-primary btn-xs" onclick={() => approveExpansionRequest(request.requestId)} disabled={approvingRequestId === request.requestId} aria-label={`Approve deployment authority expansion request ${request.requestId}`}>{approvingRequestId === request.requestId ? "Approving..." : "Approve"}</button>{/if}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                  </div>
                {/if}
              </div>
            {:else if activeDetailTab === "resources"}
              <div id={tabPanelId("resources")} class="space-y-3 text-sm" role="tabpanel" aria-labelledby={tabButtonId("resources")} tabindex="0">
                <div><span class="text-base-content/50">Resources:</span> {counts.requiredResources} required / {counts.optionalResources} optional</div>
                <div><span class="text-base-content/50">Capabilities:</span> {counts.capabilities}</div>
                <div class="space-y-2">
                  <h3 class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Boundary resources</h3>
                  {#if selectedEnvelope.boundary.resources.length === 0}
                    <p class="text-sm text-base-content/55">No authority boundary resources.</p>
                  {:else}
                    <div class="space-y-1">
                      {#each selectedEnvelope.boundary.resources as resource (`${resource.kind}:${resource.alias}`)}
                        <div class="flex items-center justify-between rounded-box border border-base-300 px-3 py-2">
                          <span><span class="badge badge-outline badge-xs">{resource.kind}</span> <span class="trellis-identifier">{resource.alias}</span></span>
                          <span class="badge badge-outline badge-xs">{resource.required ? "required" : "optional"}</span>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
                <div class="space-y-2">
                  <h3 class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Deployment resource bindings</h3>
                {#if detail?.resourceBindings.length === 0}
                  <p class="text-sm text-base-content/55">No deployment-owned resource bindings.</p>
                {:else}
                  <div class="space-y-1">
                    {#each detail?.resourceBindings ?? [] as binding (`${binding.kind}:${binding.alias}`)}
                      <div class="flex items-center justify-between rounded-box border border-base-300 px-3 py-2">
                        <span><span class="badge badge-outline badge-xs">{binding.kind}</span> <span class="trellis-identifier">{binding.alias}</span></span>
                        <span class="text-xs text-base-content/55">{formatBindingTarget(binding)}</span>
                      </div>
                    {/each}
                  </div>
                {/if}
                </div>
                <p class="text-sm text-base-content/65">Portal route: {detail?.portalRoute?.portalId ?? "No route"} {detail?.portalRoute?.entryUrl ? `· ${detail.portalRoute.entryUrl}` : ""}</p>
                <p class="text-sm text-base-content/65">Grant overrides: {grantOverrides.length}</p>
              </div>
            {:else if activeDetailTab === "grants"}
              <div id={tabPanelId("grants")} class="space-y-3 text-sm" role="tabpanel" aria-labelledby={tabButtonId("grants")} tabindex="0">
                {#if grantError}<div class="alert alert-error text-sm"><span>{grantError}</span></div>{/if}
                {#if grantResult}<div class="alert alert-success text-sm"><span>{grantResult}</span></div>{/if}

                <div class="overflow-x-auto">
                  <table class="table table-xs trellis-table min-w-[820px] table-fixed">
                    <colgroup><col class="w-[11%]" /><col class="w-[18%]" /><col class="w-[15%]" /><col class="w-[15%]" /><col class="w-[15%]" /><col class="w-[18%]" /><col class="w-[8%]" /></colgroup>
                    <thead><tr><th>Identity</th><th>Contract</th><th>Origin</th><th>Session key</th><th>Device key</th><th>Capability</th><th></th></tr></thead>
                    <tbody>
                      {#each grantOverrides as override (grantOverrideKey(override))}
                        <tr>
                          <td><span class="badge badge-outline badge-xs">{override.identityKind}</span></td>
                          <td class="trellis-identifier truncate" title={override.contractId ?? "Any"}>{override.contractId ?? "Any"}</td>
                          <td class="trellis-identifier truncate" title={override.origin ?? "Any"}>{override.origin ?? "Any"}</td>
                          <td class="trellis-identifier truncate" title={override.sessionPublicKey ?? "Any"}>{override.sessionPublicKey ?? "Any"}</td>
                          <td class="trellis-identifier truncate" title={override.devicePublicKey ?? "Any"}>{override.devicePublicKey ?? "Any"}</td>
                          <td class="trellis-identifier truncate" title={override.capability}>{override.capability}</td>
                          <td><button class="btn btn-ghost btn-xs" onclick={() => removeGrantOverride(override)} disabled={removingGrantKey === grantOverrideKey(override)} aria-label={`Remove grant override for ${override.capability}`}>{removingGrantKey === grantOverrideKey(override) ? "..." : "Remove"}</button></td>
                        </tr>
                      {:else}
                        <tr><td colspan="7" class="text-base-content/55">No grant overrides configured.</td></tr>
                      {/each}
                    </tbody>
                  </table>
                </div>

                <div class="rounded-box border border-base-300 p-3">
                  <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">Add grant overrides</div>
                  <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    <label class="form-control">
                      <span class="label-text text-xs">Identity kind</span>
                      <select class="select select-bordered select-sm" bind:value={grantIdentityKind}>
                        {#each grantIdentityKinds as kind (kind)}<option value={kind}>{kind}</option>{/each}
                      </select>
                    </label>
                    <label class="form-control">
                      <span class="label-text text-xs">Contract id</span>
                      <input class="input input-bordered input-sm trellis-identifier" placeholder="Any contract" bind:value={grantContractId} />
                    </label>
                    <label class="form-control">
                      <span class="label-text text-xs">Origin</span>
                      <input class="input input-bordered input-sm trellis-identifier" placeholder="Any origin" bind:value={grantOrigin} />
                    </label>
                    <label class="form-control">
                      <span class="label-text text-xs">Session public key</span>
                      <input class="input input-bordered input-sm trellis-identifier" placeholder="Any session key" bind:value={grantSessionPublicKey} />
                    </label>
                    <label class="form-control">
                      <span class="label-text text-xs">Device public key</span>
                      <input class="input input-bordered input-sm trellis-identifier" placeholder="Any device key" bind:value={grantDevicePublicKey} />
                    </label>
                    <label class="form-control">
                      <span class="label-text text-xs">Manual capability</span>
                      <input class="input input-bordered input-sm trellis-identifier" placeholder="capability.key" bind:value={manualGrantCapability} />
                    </label>
                  </div>

                  <div class="mt-3 max-h-64 overflow-auto rounded-box border border-base-300">
                    {#if capabilitiesError}
                      <div class="p-2 text-xs text-base-content/65">Capability catalog unavailable: {capabilitiesError}</div>
                    {:else if capabilitySections.length === 0}
                      <div class="p-2 text-xs text-base-content/65">No catalog capabilities returned. Use manual capability text.</div>
                    {:else}
                      {#each capabilitySections as section (section.key)}
                        <div class="border-b border-base-300 p-2 last:border-b-0">
                          <div class="mb-1 flex items-baseline gap-2">
                            <span class="text-xs font-semibold uppercase tracking-wide text-base-content/60">{section.title}</span>
                            {#if section.subtitle}<span class="trellis-identifier text-xs text-base-content/50">{section.subtitle}</span>{/if}
                          </div>
                          <div class="grid gap-1 md:grid-cols-2">
                            {#each section.capabilities as capability (capability.key)}
                              <label class="flex min-w-0 items-start gap-2 rounded-box px-2 py-1 hover:bg-base-200/60">
                                <input class="checkbox checkbox-xs mt-1" type="checkbox" bind:group={selectedGrantCapabilities} value={capability.key} />
                                <span class="min-w-0">
                                  <span class="block truncate text-xs font-medium" title={capability.description}>{capability.description}</span>
                                  <span class="trellis-identifier block break-all text-xs text-base-content/50">{localCapabilityKey(capability.key)}</span>
                                </span>
                              </label>
                            {/each}
                          </div>
                        </div>
                      {/each}
                    {/if}
                  </div>

                  <div class="mt-3 flex items-center justify-between gap-2">
                    <span class="text-xs text-base-content/55">Selected capabilities: {uniqueCapabilities([...selectedGrantCapabilities, manualGrantCapability]).length}</span>
                    <button class="btn btn-primary btn-sm" onclick={saveGrantOverrides} disabled={!selectedDeploymentId || grantSaving || uniqueCapabilities([...selectedGrantCapabilities, manualGrantCapability]).length === 0}>{grantSaving ? "Saving..." : "Save grant overrides"}</button>
                  </div>
                </div>
              </div>
            {:else}
              <div id={tabPanelId("manual")} class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]" role="tabpanel" aria-labelledby={tabButtonId("manual")} tabindex="0">
                <label class="sr-only" for="manual-contract-json">Contract manifest JSON for authority expansion</label>
                <textarea id="manual-contract-json" class="textarea textarea-bordered min-h-40 font-mono text-xs" placeholder="Paste contract manifest JSON" bind:value={contractJson}></textarea>
                <div class="space-y-3">
                  <label class="sr-only" for="manual-expected-digest">Expected contract digest</label>
                  <input id="manual-expected-digest" class="input input-bordered input-sm w-full" placeholder="Expected digest" bind:value={expectedDigest} />
                  <button class="btn btn-primary btn-sm w-full" onclick={expandSelectedEnvelope} disabled={!selectedDeploymentId || !contractJson || !expectedDigest || expanding} aria-label="Expand selected deployment authority from contract evidence">Expand authority</button>
                  {#if expandError}<div class="alert alert-error text-sm"><span>{expandError}</span></div>{/if}
                  {#if expandResult}<div class="alert alert-success text-sm"><span>{expandResult}</span></div>{/if}
                </div>
              </div>
            {/if}
          {:else}
            <EmptyState title="Select a deployment" description="Choose a deployment to inspect its authority boundary." />
          {/if}
        </Panel>
      </div>
    </div>
  {/if}
</section>
