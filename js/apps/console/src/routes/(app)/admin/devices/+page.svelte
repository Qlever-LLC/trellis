<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type { AuthEnvelopeExpansionsListResponse } from "@qlever-llc/trellis/auth";
  import type {
    AuthDeploymentsListOutput,
    AuthDevicesListOutput,
    AuthDeviceUserAuthoritiesListOutput,
    AuthDeviceUserAuthoritiesReviewsListOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type DeviceDeployment = Extract<AuthDeploymentsListOutput["entries"][number], { kind: "device" }>;
  type DeviceInstance = AuthDevicesListOutput["entries"][number] & {
    metadata?: Record<string, string>;
  };
  type Activation = AuthDeviceUserAuthoritiesListOutput["entries"][number];
  type Review = AuthDeviceUserAuthoritiesReviewsListOutput["entries"][number];
  type ExpansionRequest = AuthEnvelopeExpansionsListResponse["entries"][number];
  type Tab = "instances" | "activations" | "reviews";
  type StatusVariant = "healthy" | "degraded" | "unhealthy" | "offline";

  const trellis = getTrellis();
  const understoodMetadataKeys = ["name", "serialNumber", "modelNumber"] as const;
  const understoodMetadataKeySet = new Set<string>(understoodMetadataKeys);
  const tabs: Tab[] = ["instances", "activations", "reviews"];

  let loading = $state(true);
  let error = $state<string | null>(null);
  let deployments = $state.raw<DeviceDeployment[]>([]);
  let instances = $state.raw<DeviceInstance[]>([]);
  let activations = $state.raw<Activation[]>([]);
  let reviews = $state.raw<Review[]>([]);
  let expansionRequests = $state.raw<ExpansionRequest[]>([]);

  let selectedDeploymentId = $state("");
  let activeTab = $state<Tab>("instances");
  let search = $state("");
  let showMetadata = $state(false);
  let selectedReviewId = $state<string | null>(null);

  const selectedDeployment = $derived(deployments.find((deployment) => deployment.deploymentId === selectedDeploymentId) ?? null);
  const deviceDeploymentIds = $derived.by(() => new Set(deployments.map((deployment) => deployment.deploymentId)));
  const instancesById = $derived.by(() => new Map(instances.map((instance) => [instance.instanceId, instance])));
  const selectedInstances = $derived(instances.filter((instance) => instance.deploymentId === selectedDeploymentId));
  const selectedActivations = $derived(activations.filter((activation) => activation.deploymentId === selectedDeploymentId));
  const selectedReviews = $derived(reviews.filter((review) => review.deploymentId === selectedDeploymentId));
  const selectedPendingReviews = $derived(selectedReviews.filter((review) => review.state === "pending"));
  const selectedExpansionRequests = $derived.by(() =>
    expansionRequests
      .filter((request) => request.deploymentId === selectedDeploymentId && request.state === "pending")
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
  );
  const pendingExpansionRequests = $derived.by(() =>
    expansionRequests
      .filter((request) => request.state === "pending" && deviceDeploymentIds.has(request.deploymentId))
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
  );
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

  function syncSelectedDeployment(nextDeployments: DeviceDeployment[]) {
    if (nextDeployments.some((deployment) => deployment.deploymentId === selectedDeploymentId)) return;
    selectedDeploymentId = nextDeployments[0]?.deploymentId ?? "";
    selectedReviewId = null;
  }

  function selectDeployment(deploymentId: string) {
    selectedDeploymentId = deploymentId;
    selectedReviewId = null;
  }

  function selectTab(tab: Tab) {
    activeTab = tab;
  }

  function statusForDisabled(disabled: boolean): StatusVariant {
    return disabled ? "offline" : "healthy";
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

  function badgeClassForDeployment(disabled: boolean): string {
    return disabled ? "badge-neutral" : "badge-success";
  }

  function dotClassForDeployment(disabled: boolean): string {
    return disabled ? "bg-base-content/30" : "bg-success";
  }

  function deploymentInstances(deploymentId: string): DeviceInstance[] {
    return instances.filter((instance) => instance.deploymentId === deploymentId);
  }

  function pendingReviewsForDeployment(deploymentId: string): number {
    return reviews.filter((review) => review.deploymentId === deploymentId && review.state === "pending").length;
  }

  function pendingRequestsForDeployment(deploymentId: string): number {
    return pendingExpansionRequests.filter((request) => request.deploymentId === deploymentId).length;
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

  async function load() {
    loading = true;
    error = null;
    try {
      const [deploymentsResponse, instancesResponse, activationsResponse, reviewsResponse, expansionRequestsResponse] = await Promise.all([
        trellis.request("Auth.Deployments.List", { kind: "device", limit: 500, offset: 0 }).take(),
        trellis.request("Auth.Devices.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.DeviceUserAuthorities.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.DeviceUserAuthorities.Reviews.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.EnvelopeExpansions.List", { state: "pending", limit: 500, offset: 0 }).take(),
      ]);

      if (isErr(deploymentsResponse)) { error = errorMessage(deploymentsResponse); return; }
      if (isErr(instancesResponse)) { error = errorMessage(instancesResponse); return; }
      if (isErr(activationsResponse)) { error = errorMessage(activationsResponse); return; }
      if (isErr(reviewsResponse)) { error = errorMessage(reviewsResponse); return; }
      if (isErr(expansionRequestsResponse)) { error = errorMessage(expansionRequestsResponse); return; }

      deployments = (deploymentsResponse.entries ?? []).filter((deployment): deployment is DeviceDeployment => deployment.kind === "device");
      instances = instancesResponse.entries ?? [];
      activations = activationsResponse.entries ?? [];
      reviews = reviewsResponse.entries ?? [];
      expansionRequests = expansionRequestsResponse.entries ?? [];
      syncSelectedDeployment(deployments);
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
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading devices" /></Panel>
  {:else}
    <div class="grid min-h-[calc(100vh-12rem)] items-stretch gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <Panel title="Deployments" eyebrow={`${deployments.length} deployment${deployments.length === 1 ? "" : "s"}`} class="flex min-w-0 flex-col xl:h-full [&>.card-body]:flex-1">
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
              {@const pendingRequestCount = pendingRequestsForDeployment(deployment.deploymentId)}
              <button
                type="button"
                class={[
                  "w-full rounded-box border p-3 text-left transition-colors",
                  selectedDeploymentId === deployment.deploymentId ? "border-primary bg-primary/5" : "border-base-300 bg-base-100 hover:border-base-content/20",
                ]}
                onclick={() => selectDeployment(deployment.deploymentId)}
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class={["h-2.5 w-2.5 rounded-full", dotClassForDeployment(deployment.disabled)]}></span>
                      <span class="trellis-identifier truncate font-medium">{deployment.deploymentId}</span>
                    </div>
                    <div class="mt-1 text-xs text-base-content/60">{activeDevices.length}/{deploymentDeviceInstances.length} activated instances</div>
                    <div class="mt-1 flex flex-wrap gap-1">
                      <span class="badge badge-outline badge-xs">review {deployment.reviewMode ?? "none"}</span>
                      {#if pendingReviewCount > 0}<span class="badge badge-warning badge-xs">{pendingReviewCount} review</span>{/if}
                      {#if pendingRequestCount > 0}<span class="badge badge-warning badge-xs">{pendingRequestCount} authority</span>{/if}
                    </div>
                  </div>
                  <span class={["badge badge-sm", badgeClassForDeployment(deployment.disabled)]}>{deployment.disabled ? "Disabled" : "Active"}</span>
                </div>
              </button>
            {:else}
              <EmptyState title="No matches" description="Try a different deployment ID or review mode." class="py-4" />
            {/each}
          </div>
        {/if}

        {#snippet footer()}
          <span>{deployments.filter((deployment) => deployment.disabled).length} disabled / archived</span>
        {/snippet}
      </Panel>

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
                    <StatusBadge label={selectedDeployment.disabled ? "Disabled" : "Active"} status={statusForDisabled(selectedDeployment.disabled)} />
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
              <span class="badge badge-outline badge-sm">{selectedExpansionRequests.length} pending authority request{selectedExpansionRequests.length === 1 ? "" : "s"}</span>
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

            {#if selectedExpansionRequests.length > 0}
              <div class="mt-3 rounded-box border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div class="font-medium">Authority expansion pending</div>
                    <div class="mt-1 text-xs text-base-content/70">Requested authority changes are awaiting review outside this page.</div>
                  </div>
                  <div class="flex flex-wrap gap-1">
                    {#each selectedExpansionRequests.slice(0, 3) as request (request.requestId)}
                      <span class="badge badge-outline badge-sm trellis-identifier">{request.contractId}</span>
                    {/each}
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
                  <div class="overflow-x-auto">
                    <table class="table table-sm trellis-table">
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
                    </table>
                  </div>
                {/if}
              {:else if activeTab === "activations"}
                {#if selectedActivations.length === 0}
                  <EmptyState title="No device activations" description="Activation records for this deployment appear here." />
                {:else}
                  <div class="overflow-x-auto">
                    <table class="table table-sm trellis-table">
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
                    </table>
                  </div>
                {/if}
              {:else if activeTab === "reviews"}
                <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
                  <div class="min-w-0">
                    {#if selectedReviews.length === 0}
                      <EmptyState title="No device reviews" description="Activation reviews for this deployment appear here." />
                    {:else}
                      <div class="overflow-x-auto">
                        <table class="table table-sm trellis-table">
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
                        </table>
                      </div>
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
              {/if}
            </div>
          </Panel>
        {/if}
      </div>
    </div>
  {/if}
</section>
