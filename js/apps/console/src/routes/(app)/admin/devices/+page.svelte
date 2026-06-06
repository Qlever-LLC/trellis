<script lang="ts">
  import { isErr, type BaseError, type Result } from "@qlever-llc/result";
  import type { DeploymentAuthority, DeploymentAuthorityMaterialization } from "@qlever-llc/trellis/auth";
  import type {
    AuthDeploymentsListOutput,
    AuthDevicesListOutput,
    AuthDeviceUserAuthoritiesListOutput,
    AuthDeviceUserAuthoritiesReviewsListOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import SelectableRecordButton from "$lib/components/SelectableRecordButton.svelte";
  import SelectionRail from "$lib/components/SelectionRail.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import {
    type AuthorityCapabilityDefinition,
    createsCapabilityRows,
    givenCapabilityRows,
  } from "$lib/authority_console";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type DeviceDeployment = Extract<AuthDeploymentsListOutput["entries"][number], { kind: "device" }>;
  type DeviceInstance = AuthDevicesListOutput["entries"][number] & {
    metadata?: Record<string, string>;
  };
  type Activation = AuthDeviceUserAuthoritiesListOutput["entries"][number];
  type Review = AuthDeviceUserAuthoritiesReviewsListOutput["entries"][number];
  type AuthorityDetail = { authority: DeploymentAuthority; materializedAuthority: DeploymentAuthorityMaterialization | null; portalRoute: unknown; grantOverrides: unknown[]; capabilityDefinitions?: AuthorityCapabilityDefinition[] };
  type RpcTakeable<T> = { take(): Promise<T | Result<never, BaseError>> };
  type AuthorityRequest = {
    (method: "Auth.DeploymentAuthority.List", input: { kind: "device"; limit: number; offset: number }): RpcTakeable<{ entries?: DeploymentAuthority[] }>;
    (method: "Auth.DeploymentAuthority.Get", input: { deploymentId: string }): RpcTakeable<AuthorityDetail>;
    (method: "Auth.Capabilities.List", input: { limit: number; offset: number }): RpcTakeable<{ entries?: AuthorityCapabilityDefinition[] }>;
  };
  type Tab = "instances" | "activations" | "reviews" | "authority";
  type StatusVariant = "healthy" | "degraded" | "unhealthy" | "offline";

  const trellis = getTrellis();
  const authorityRequest = trellis.request.bind(trellis) as AuthorityRequest;
  const understoodMetadataKeys = ["name", "serialNumber", "modelNumber"] as const;
  const understoodMetadataKeySet = new Set<string>(understoodMetadataKeys);
  const tabs: Tab[] = ["instances", "activations", "reviews", "authority"];
  let authorityDetailRequestToken = 0;

  let loading = $state(true);
  let error = $state<string | null>(null);
  let deployments = $state.raw<DeviceDeployment[]>([]);
  let instances = $state.raw<DeviceInstance[]>([]);
  let activations = $state.raw<Activation[]>([]);
  let reviews = $state.raw<Review[]>([]);
  let deploymentAuthorities = $state.raw<DeploymentAuthority[]>([]);
  let selectedAuthorityDetail = $state.raw<AuthorityDetail | null>(null);
  let capabilityDefinitions = $state.raw<AuthorityCapabilityDefinition[]>([]);

  let selectedDeploymentId = $state("");
  let activeTab = $state<Tab>("instances");
  let search = $state("");
  let showMetadata = $state(false);
  let selectedReviewId = $state<string | null>(null);

  const selectedDeployment = $derived(deployments.find((deployment) => deployment.deploymentId === selectedDeploymentId) ?? null);
  const instancesById = $derived.by(() => new Map(instances.map((instance) => [instance.instanceId, instance])));
  const selectedInstances = $derived(instances.filter((instance) => instance.deploymentId === selectedDeploymentId));
  const selectedActivations = $derived(activations.filter((activation) => activation.deploymentId === selectedDeploymentId));
  const selectedReviews = $derived(reviews.filter((review) => review.deploymentId === selectedDeploymentId));
  const selectedPendingReviews = $derived(selectedReviews.filter((review) => review.state === "pending"));
  const selectedDeploymentAuthority = $derived(selectedAuthorityDetail?.authority ?? deploymentAuthorities.find((authority) => authority.deploymentId === selectedDeploymentId) ?? null);
  const selectedMaterializedAuthority = $derived(selectedAuthorityDetail?.materializedAuthority ?? null);
  const selectedCapabilityDefinitions = $derived(selectedAuthorityDetail?.capabilityDefinitions ?? capabilityDefinitions);
  const createsRows = $derived(selectedDeploymentAuthority ? createsCapabilityRows(selectedDeploymentAuthority, selectedCapabilityDefinitions) : []);
  const givenRows = $derived(selectedDeploymentAuthority ? givenCapabilityRows(selectedDeploymentAuthority, selectedMaterializedAuthority, selectedCapabilityDefinitions) : []);
  const filteredDeployments = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return deployments;
    return deployments.filter((deployment) =>
      deployment.deploymentId.toLowerCase().includes(term) || (deployment.reviewMode ?? "").toLowerCase().includes(term)
    );
  });
  const selectedReview = $derived(selectedReviews.find((review) => review.reviewId === selectedReviewId) ?? selectedReviews[0] ?? null);
  const activeInstanceCount = $derived(selectedInstances.filter((instance) => instance.state === "activated").length);
  const revokedActivationCount = $derived(selectedActivations.filter((activation) => activation.state === "revoked").length);

  function syncSelectedDeployment(nextDeployments: DeviceDeployment[]): string {
    const nextDeploymentId = nextDeployments.some((deployment) => deployment.deploymentId === selectedDeploymentId)
      ? selectedDeploymentId
      : nextDeployments[0]?.deploymentId ?? "";
    if (nextDeploymentId !== selectedDeploymentId) selectedReviewId = null;
    selectedDeploymentId = nextDeploymentId;
    return nextDeploymentId;
  }

  function selectDeployment(deploymentId: string) {
    selectedDeploymentId = deploymentId;
    selectedReviewId = null;
    void loadAuthorityDetail(deploymentId);
  }

  function selectTab(tab: Tab) {
    activeTab = tab;
  }

  function deploymentStatus(): StatusVariant {
    return "offline";
  }

  function instanceStatus(state: DeviceInstance["state"]): StatusVariant {
    if (state === "activated") return "healthy";
    if (state === "registered") return "degraded";
    if (state === "revoked") return "unhealthy";
    return "offline";
  }

  function activationStatus(state: Activation["state"]): StatusVariant {
    return state === "activated" ? "healthy" : "unhealthy";
  }

  function reviewStatus(state: Review["state"]): StatusVariant {
    if (state === "approved") return "healthy";
    if (state === "pending") return "degraded";
    if (state === "rejected") return "unhealthy";
    return "offline";
  }

  function materializedStatus(status: string): StatusVariant {
    if (status === "current" || status === "granted") return "healthy";
    if (status === "pending") return "degraded";
    if (status === "failed" || status === "not-materialized") return "unhealthy";
    return "offline";
  }

  function materializedStatusLabel(status: string): string {
    return status === "not-materialized" ? "not materialized" : status;
  }

  function badgeClassForDeployment(): string {
    return "badge-neutral";
  }

  function dotClassForDeployment(): string {
    return "bg-base-content/30";
  }

  function deploymentInstances(deploymentId: string): DeviceInstance[] {
    return instances.filter((instance) => instance.deploymentId === deploymentId);
  }

  function pendingReviewsForDeployment(deploymentId: string): number {
    return reviews.filter((review) => review.deploymentId === deploymentId && review.state === "pending").length;
  }

  function metadataValue(instanceId: string, key: (typeof understoodMetadataKeys)[number]): string | null {
    return instancesById.get(instanceId)?.metadata?.[key] ?? null;
  }

  function metadataEntries(instanceId: string): Array<[string, string]> {
    return Object.entries(instancesById.get(instanceId)?.metadata ?? {}).filter(([key]) => !understoodMetadataKeySet.has(key));
  }

  function instanceRowKey(instance: DeviceInstance): string {
    return `${instance.instanceId}:${instance.createdAt}:${instance.publicIdentityKey}`;
  }

  function activationRowKey(activation: Activation): string {
    return `${activation.instanceId}:${activation.activatedAt}:${activation.revokedAt ?? ""}:${activation.state}`;
  }

  function tabLabel(tab: Tab): string {
    return tab[0].toUpperCase() + tab.slice(1);
  }

  function tabId(tab: Tab): string {
    return `device-detail-tab-${tab}`;
  }

  function tabPanelId(tab: Tab): string {
    return `device-detail-panel-${tab}`;
  }

  function formatActivatedBy(actor: Activation["activatedBy"]): string {
    return actor ? `${actor.participantKind}:${actor.identity.provider}:${actor.identity.subject}` : "—";
  }

  async function loadAuthorityDetail(deploymentId: string) {
    authorityDetailRequestToken += 1;
    const requestToken = authorityDetailRequestToken;
    if (!deploymentId) {
      selectedAuthorityDetail = null;
      return;
    }
    selectedAuthorityDetail = null;
    try {
      const response = await authorityRequest("Auth.DeploymentAuthority.Get", { deploymentId }).take();
      if (requestToken !== authorityDetailRequestToken) return;
      if (isErr(response)) { error = errorMessage(response); return; }
      selectedAuthorityDetail = response;
    } catch (cause) {
      if (requestToken !== authorityDetailRequestToken) return;
      error = errorMessage(cause);
    }
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [deploymentsResponse, instancesResponse, activationsResponse, reviewsResponse, authoritiesResponse, capabilitiesResponse] = await Promise.all([
        trellis.request("Auth.Deployments.List", { kind: "device", limit: 500, offset: 0 }).take(),
        trellis.request("Auth.Devices.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.DeviceUserAuthorities.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.DeviceUserAuthorities.Reviews.List", { limit: 500, offset: 0 }).take(),
        authorityRequest("Auth.DeploymentAuthority.List", { kind: "device", limit: 500, offset: 0 }).take(),
        authorityRequest("Auth.Capabilities.List", { limit: 500, offset: 0 }).take(),
      ]);

      if (isErr(deploymentsResponse)) { error = errorMessage(deploymentsResponse); return; }
      if (isErr(instancesResponse)) { error = errorMessage(instancesResponse); return; }
      if (isErr(activationsResponse)) { error = errorMessage(activationsResponse); return; }
      if (isErr(reviewsResponse)) { error = errorMessage(reviewsResponse); return; }
      if (isErr(authoritiesResponse)) { error = errorMessage(authoritiesResponse); return; }
      if (isErr(capabilitiesResponse)) { error = errorMessage(capabilitiesResponse); return; }

      deployments = (deploymentsResponse.entries ?? []).filter((deployment): deployment is DeviceDeployment => deployment.kind === "device");
      instances = instancesResponse.entries ?? [];
      activations = activationsResponse.entries ?? [];
      reviews = reviewsResponse.entries ?? [];
      deploymentAuthorities = authoritiesResponse.entries ?? [];
      capabilityDefinitions = capabilitiesResponse.entries ?? [];
      const nextDeploymentId = syncSelectedDeployment(deployments);
      await loadAuthorityDetail(nextDeploymentId);
      if (selectedReviewId && !reviews.some((review) => review.reviewId === selectedReviewId)) selectedReviewId = null;
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar
    title="Devices"
    description="Manage device deployments, provisioned identities, activation state, and review decisions from one operator surface."
  >
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
      <a class="btn btn-outline btn-sm" href={resolve("/admin/devices/profiles/new")}>Create deployment</a>
      <a class="btn btn-outline btn-sm" href={resolve("/admin/devices/instances/provision")}>Provision device</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <Notice variant="error">{error}</Notice>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading devices" /></Panel>
  {:else}
    <div class="grid min-h-[calc(100vh-12rem)] items-stretch gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <SelectionRail title="Deployments" eyebrow={`${deployments.length} deployment${deployments.length === 1 ? "" : "s"}`}>
        <div class="mb-3">
          <label class="input input-bordered input-sm flex items-center gap-2">
            <Icon name="search" size={14} class="text-base-content/50" />
            <input bind:value={search} class="grow" placeholder="Search ID or review mode" aria-label="Search deployments" />
          </label>
        </div>

        {#if deployments.length === 0}
          <EmptyState title="No device deployments" description="Create a deployment before provisioning device identities." />
        {:else}
          <div class="space-y-2">
            {#each filteredDeployments as deployment (deployment.deploymentId)}
              {@const deploymentDeviceInstances = deploymentInstances(deployment.deploymentId)}
              {@const activeDevices = deploymentDeviceInstances.filter((instance) => instance.state === "activated")}
              {@const pendingReviewCount = pendingReviewsForDeployment(deployment.deploymentId)}
              {@const trackedAuthority = deploymentAuthorities.find((authority) => authority.deploymentId === deployment.deploymentId)}
              <SelectableRecordButton
                selected={selectedDeploymentId === deployment.deploymentId}
                onclick={() => selectDeployment(deployment.deploymentId)}
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class={["h-2.5 w-2.5 rounded-full", dotClassForDeployment()]}></span>
                      <span class="trellis-identifier truncate font-medium">{deployment.deploymentId}</span>
                    </div>
                    <div class="mt-1 text-xs text-base-content/60">{activeDevices.length}/{deploymentDeviceInstances.length} activated instances</div>
                    <div class="mt-1 flex flex-wrap gap-1">
                      <span class="badge badge-outline badge-xs">review {deployment.reviewMode ?? "none"}</span>
                      {#if pendingReviewCount > 0}<span class="badge badge-warning badge-xs">{pendingReviewCount} review</span>{/if}
                      {#if trackedAuthority}<span class="badge badge-outline badge-xs">authority {trackedAuthority.disabled ? "disabled" : "tracked"}</span>{/if}
                    </div>
                  </div>
                  <span class={["badge badge-sm", badgeClassForDeployment()]}>{deployment.disabled ? "Disabled" : "Enabled"}</span>
                </div>
              </SelectableRecordButton>
            {:else}
              <EmptyState title="No matches" description="Try a different deployment ID or review mode." class="py-4" />
            {/each}
          </div>
        {/if}

        {#snippet footer()}
          <span>{deployments.filter((deployment) => deployment.disabled).length} disabled / archived</span>
        {/snippet}
      </SelectionRail>

      <div class="flex min-w-0 flex-col gap-4">
        {#if !selectedDeployment}
          <Panel><EmptyState title="Select a deployment" description="Choose a device deployment from the left rail to inspect instances, activations, and reviews." /></Panel>
        {:else}
          <Panel class="flex min-w-0 flex-1 flex-col [&>.card-body]:flex-1">
            <div class="flex flex-wrap items-start justify-between gap-3 border-b border-base-300 pb-3">
              <div class="flex min-w-0 items-start gap-3">
                <div class="rounded-box bg-primary/10 p-2.5 text-primary"><Icon name="phone" size={22} /></div>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="trellis-identifier truncate text-lg font-semibold">{selectedDeployment.deploymentId}</h2>
                    <StatusBadge label={selectedDeployment.disabled ? "Disabled" : "Enabled"} status={deploymentStatus()} />
                  </div>
                  <div class="mt-1 text-sm text-base-content/60">Review mode: <span class="badge badge-outline badge-sm">{selectedDeployment.reviewMode ?? "none"}</span></div>
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                {#if !selectedDeployment.disabled}
                  <a class="btn btn-error btn-outline btn-sm" href={resolve(`/admin/devices/profiles/disable?deployment=${encodeURIComponent(selectedDeployment.deploymentId)}`)}>Disable deployment</a>
                {/if}
              </div>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span class="badge badge-outline badge-sm">{activeInstanceCount}/{selectedInstances.length} activated instances</span>
              <span class="badge badge-outline badge-sm">{selectedPendingReviews.length} pending review{selectedPendingReviews.length === 1 ? "" : "s"}</span>
              <span class="badge badge-outline badge-sm">authority {selectedDeploymentAuthority?.version ?? "not loaded"}</span>
              <span class="badge badge-outline badge-sm">{createsRows.length} Creates</span>
              <span class="badge badge-outline badge-sm">{givenRows.length} Given</span>
              <span class="badge badge-outline badge-sm">{selectedActivations.length} activation{selectedActivations.length === 1 ? "" : "s"}</span>
              <span class="badge badge-outline badge-sm">{revokedActivationCount} revoked</span>
            </div>

            {#if selectedPendingReviews.length > 0}
              <div class="mt-3 rounded-box border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div class="font-medium">Activation review required</div>
                    <div class="mt-1 text-xs text-base-content/70">Pending device activations need an approve or reject decision.</div>
                  </div>
                  <button type="button" class="btn btn-ghost btn-xs" onclick={() => selectTab("reviews")}>{selectedPendingReviews.length} pending review{selectedPendingReviews.length === 1 ? "" : "s"}</button>
                </div>
              </div>
            {/if}

            {#if selectedDeploymentAuthority}
              <div class="mt-3 rounded-box border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div class="font-medium">Deployment authority tracked</div>
                    <div class="mt-1 text-xs text-base-content/70">Desired device authority is reconciled into materialized runtime grants.</div>
                  </div>
                  <div class="flex flex-wrap gap-1">
                    <span class="badge badge-outline badge-sm trellis-identifier">{selectedDeploymentAuthority.version}</span>
                    {#if selectedMaterializedAuthority}<StatusBadge label={`materialized ${selectedMaterializedAuthority.status}`} status={materializedStatus(selectedMaterializedAuthority.status)} />{/if}
                    <button type="button" class="btn btn-ghost btn-xs" onclick={() => selectTab("authority")}>Open authority</button>
                  </div>
                </div>
              </div>
            {/if}

            <div class="tabs tabs-box tabs-sm mt-4 w-fit bg-base-200/70 p-1" role="tablist" aria-label="Deployment detail sections">
              {#each tabs as tab (tab)}
                <button type="button" id={tabId(tab)} role="tab" aria-selected={activeTab === tab} aria-controls={tabPanelId(tab)} class={["tab rounded-field px-4", activeTab === tab && "tab-active bg-base-100 shadow-sm"]} onclick={() => selectTab(tab)}>{tabLabel(tab)}</button>
              {/each}
            </div>

            <div id={tabPanelId(activeTab)} class="mt-4 flex-1" role="tabpanel" aria-labelledby={tabId(activeTab)}>
              {#if activeTab === "instances"}
                <div class="mb-2 flex justify-end">
                  <label class="label cursor-pointer gap-2 py-0">
                    <span class="label-text text-sm">Metadata</span>
                    <input class="toggle toggle-sm" type="checkbox" bind:checked={showMetadata} />
                  </label>
                </div>
                {#if selectedInstances.length === 0}
                  <EmptyState title="No device instances" description="Provisioned device identities for this deployment appear here." />
                {:else}
                  <DataTable>
                      <thead><tr><th>Instance</th><th>Identity key</th><th>Name</th><th>Serial</th><th>Model</th>{#if showMetadata}<th>Metadata</th>{/if}<th>State</th><th>Created</th><th>Actions</th></tr></thead>
                      <tbody>
                        {#each selectedInstances as instance (instanceRowKey(instance))}
                          <tr>
                            <td class="trellis-identifier font-medium">{instance.instanceId}</td>
                            <td class="trellis-identifier text-base-content/60">{instance.publicIdentityKey}</td>
                            <td class="text-base-content/60">{instance.metadata?.name ?? "—"}</td>
                            <td class="text-base-content/60">{instance.metadata?.serialNumber ?? "—"}</td>
                            <td class="text-base-content/60">{instance.metadata?.modelNumber ?? "—"}</td>
                            {#if showMetadata}
                              <td class="text-xs text-base-content/60">
                                {#if metadataEntries(instance.instanceId).length > 0}
                                  <div class="space-y-1">
                                    {#each metadataEntries(instance.instanceId) as [key, value] (key)}
                                      <div><span class="font-medium text-base-content">{key}</span>=<span class="trellis-identifier">{value}</span></div>
                                    {/each}
                                  </div>
                                {:else}
                                  —
                                {/if}
                              </td>
                            {/if}
                            <td><StatusBadge label={instance.state} status={instanceStatus(instance.state)} /></td>
                            <td class="text-base-content/60">{formatDate(instance.createdAt)}</td>
                            <td>
                              {#if instance.state === "disabled"}
                                <span class="text-xs text-base-content/40">—</span>
                              {:else}
                                <a class="btn btn-error btn-outline btn-xs" href={resolve(`/admin/devices/instances/disable?instance=${encodeURIComponent(instance.instanceId)}`)}>Disable</a>
                              {/if}
                            </td>
                          </tr>
                        {/each}
                      </tbody>
                  </DataTable>
                {/if}
              {:else if activeTab === "activations"}
                {#if selectedActivations.length === 0}
                  <EmptyState title="No device activations" description="Activation records for this deployment appear here." />
                {:else}
                  <DataTable>
                      <thead><tr><th>Instance</th><th>Activated by</th><th>State</th><th>Activated</th><th>Revoked</th><th>Actions</th></tr></thead>
                      <tbody>
                        {#each selectedActivations as activation (activationRowKey(activation))}
                          <tr>
                            <td><div class="trellis-identifier font-medium">{activation.instanceId}</div><div class="trellis-identifier text-xs text-base-content/60">{activation.publicIdentityKey}</div></td>
                            <td class="text-base-content/60">{formatActivatedBy(activation.activatedBy)}</td>
                            <td><StatusBadge label={activation.state} status={activationStatus(activation.state)} /></td>
                            <td class="text-base-content/60">{formatDate(activation.activatedAt)}</td>
                            <td class="text-base-content/60">{activation.revokedAt ? formatDate(activation.revokedAt) : "—"}</td>
                            <td>
                              {#if activation.state === "revoked"}
                                <span class="text-xs text-base-content/40">—</span>
                              {:else}
                                <a class="btn btn-error btn-outline btn-xs" href={resolve(`/admin/devices/activations/revoke?instance=${encodeURIComponent(activation.instanceId)}`)}>Revoke</a>
                              {/if}
                            </td>
                          </tr>
                        {/each}
                      </tbody>
                  </DataTable>
                {/if}
              {:else if activeTab === "reviews"}
                <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
                  <div class="min-w-0">
                    {#if selectedReviews.length === 0}
                      <EmptyState title="No device reviews" description="Activation reviews for this deployment appear here." />
                    {:else}
                      <DataTable>
                          <thead><tr><th>Review</th><th>Instance</th><th>State</th><th>Requested</th><th>Actions</th></tr></thead>
                          <tbody>
                            {#each selectedReviews as review (review.reviewId)}
                              <tr class={{ "bg-base-200/60": selectedReview?.reviewId === review.reviewId }}>
                                <td><button class="trellis-identifier text-left hover:underline" onclick={() => (selectedReviewId = review.reviewId)}>{review.reviewId}</button></td>
                                <td><div class="trellis-identifier">{review.instanceId}</div><div class="trellis-identifier text-xs text-base-content/60">{review.publicIdentityKey}</div></td>
                                <td><StatusBadge label={review.state} status={reviewStatus(review.state)} /></td>
                                <td class="text-base-content/60">{formatDate(review.requestedAt)}</td>
                                <td>
                                  {#if review.state === "pending"}
                                    <a class="btn btn-ghost btn-xs" href={resolve(`/admin/devices/reviews/decide?review=${encodeURIComponent(review.reviewId)}`)}>Decide</a>
                                  {:else}
                                    <span class="text-xs text-base-content/40">—</span>
                                  {/if}
                                </td>
                              </tr>
                            {/each}
                          </tbody>
                      </DataTable>
                    {/if}
                  </div>
                  <div class="rounded-box border border-base-300 bg-base-200/30 p-3">
                    {#if selectedReview}
                      <div class="space-y-3 text-sm">
                        <div class="flex items-center justify-between gap-3">
                          <span class="trellis-identifier font-medium">{selectedReview.reviewId}</span>
                          <StatusBadge label={selectedReview.state} status={reviewStatus(selectedReview.state)} />
                        </div>
                        <div>
                          <p class="text-[0.65rem] font-semibold uppercase tracking-wider text-base-content/50">Instance</p>
                          <p class="trellis-identifier">{selectedReview.instanceId}</p>
                          <p class="trellis-identifier text-base-content/60">{selectedReview.publicIdentityKey}</p>
                        </div>
                        <div class="grid grid-cols-2 gap-2 text-xs">
                          <div><span class="text-base-content/50">Requested</span><div>{formatDate(selectedReview.requestedAt)}</div></div>
                          <div><span class="text-base-content/50">Decided</span><div>{selectedReview.decidedAt ? formatDate(selectedReview.decidedAt) : "—"}</div></div>
                          <div class="col-span-2"><span class="text-base-content/50">Reason</span><div>{selectedReview.reason ?? "—"}</div></div>
                        </div>
                        <div class="space-y-0.5 text-xs text-base-content/60">
                          <div><span class="font-medium text-base-content">Name</span>: {metadataValue(selectedReview.instanceId, "name") ?? "—"}</div>
                          <div><span class="font-medium text-base-content">Serial</span>: {metadataValue(selectedReview.instanceId, "serialNumber") ?? "—"}</div>
                          <div><span class="font-medium text-base-content">Model</span>: {metadataValue(selectedReview.instanceId, "modelNumber") ?? "—"}</div>
                        </div>
                        {#if selectedReview.state === "pending"}
                          <a class="btn btn-outline btn-sm w-full" href={resolve(`/admin/devices/reviews/decide?review=${encodeURIComponent(selectedReview.reviewId)}`)}>Decide review</a>
                        {/if}
                      </div>
                    {:else}
                      <EmptyState title="Select a review" description="Choose a review to inspect activation metadata." class="py-4" />
                    {/if}
                  </div>
                </div>
              {:else if activeTab === "authority"}
                {#if !selectedDeploymentAuthority}
                  <EmptyState title="No deployment authority" description="This device deployment does not have accepted authority details yet." />
                {:else}
                  <div class="space-y-4">
                    <div class="flex flex-wrap items-center gap-2 text-sm">
                      <span class="badge badge-outline badge-sm trellis-identifier">desired {selectedDeploymentAuthority.version}</span>
                      {#if selectedMaterializedAuthority}
                        <StatusBadge label={`materialized ${selectedMaterializedAuthority.status}`} status={materializedStatus(selectedMaterializedAuthority.status)} />
                        <span class="badge badge-outline badge-sm">{selectedMaterializedAuthority.grants.length} materialized grants</span>
                      {:else}
                        <StatusBadge label="materialized unknown" status="offline" />
                      {/if}
                    </div>

                    <div class="rounded-box border border-base-300 bg-base-100">
                      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 px-3 py-2">
                        <div>
                          <h3 class="font-medium">Creates</h3>
                          <p class="text-xs text-base-content/60">Capability definitions this device deployment provides for other participants.</p>
                        </div>
                        <span class="badge badge-outline badge-sm">{createsRows.length}</span>
                      </div>
                      <DataTable><thead><tr><th>Capability</th><th>Definition</th><th>Source</th><th>Contract</th></tr></thead><tbody>{#each createsRows as row (row.id)}<tr><td><div class="trellis-identifier font-medium">{row.capability}</div>{#if row.consequence}<div class="text-xs text-base-content/60">{row.consequence}</div>{/if}</td><td><div>{row.displayName}</div><div class="text-xs text-base-content/60">{row.description}</div></td><td><span class="badge badge-outline badge-xs">{row.source}</span></td><td><div class="trellis-identifier text-xs">{row.contractId ?? "platform"}</div>{#if row.contractDigest}<div class="trellis-identifier text-xs text-base-content/50">{row.contractDigest}</div>{/if}</td></tr>{:else}<tr><td colspan="4"><EmptyState title="No Creates capabilities" description="No capability definitions for this deployment are available from authority APIs." /></td></tr>{/each}</tbody></DataTable>
                    </div>

                    <div class="rounded-box border border-base-300 bg-base-100">
                      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 px-3 py-2">
                        <div>
                          <h3 class="font-medium">Given</h3>
                          <p class="text-xs text-base-content/60">Capability needs accepted for this device deployment and the matching materialized grants.</p>
                        </div>
                        <span class="badge badge-outline badge-sm">{givenRows.length}</span>
                      </div>
                      <DataTable><thead><tr><th>Capability</th><th>Need</th><th>Materialized</th><th>Definition</th><th>Contract</th></tr></thead><tbody>{#each givenRows as row (row.id)}<tr><td><div class="trellis-identifier font-medium">{row.capability}</div>{#if row.consequence}<div class="text-xs text-base-content/60">{row.consequence}</div>{/if}</td><td><span class="badge badge-outline badge-xs">{row.availability}</span></td><td><StatusBadge label={materializedStatusLabel(row.materializedStatus)} status={materializedStatus(row.materializedStatus)} />{#if row.materializedGrantCount > 1}<div class="mt-1 text-xs text-base-content/60">{row.materializedGrantCount} grants</div>{/if}</td><td><div>{row.displayName}</div><div class="text-xs text-base-content/60">{row.description}</div><div class="mt-1"><span class="badge badge-outline badge-xs">{row.source}</span></div></td><td><div class="trellis-identifier text-xs">{row.contractId ?? "authority"}</div>{#if row.contractDigest}<div class="trellis-identifier text-xs text-base-content/50">{row.contractDigest}</div>{/if}</td></tr>{:else}<tr><td colspan="5"><EmptyState title="No Given capabilities" description="This deployment authority has no accepted capability needs or materialized capability grants." /></td></tr>{/each}</tbody></DataTable>
                    </div>
                  </div>
                {/if}
              {/if}
            </div>
          </Panel>
        {/if}
      </div>
    </div>
  {/if}
</section>
