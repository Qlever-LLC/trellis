<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthDevicesListInput,
    AuthDevicesListOutput,
    AuthDeploymentsListOutput,
    AuthDeviceUserAuthoritiesListInput,
    AuthDeviceUserAuthoritiesListOutput,
    AuthDeviceUserAuthoritiesReviewsListInput,
    AuthDeviceUserAuthoritiesReviewsListOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { base } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import InlineMetricsStrip from "$lib/components/InlineMetricsStrip.svelte";
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
  type Tab = "deployments" | "instances" | "activations" | "reviews";
  type DeploymentStatus = "all" | "active" | "disabled";
  type InstanceState = NonNullable<AuthDevicesListInput["state"]> | "all";
  type ActivationState = NonNullable<AuthDeviceUserAuthoritiesListInput["state"]> | "all";
  type ReviewState = NonNullable<AuthDeviceUserAuthoritiesReviewsListInput["state"]> | "all";
  type StatusVariant = "healthy" | "degraded" | "unhealthy" | "offline";

  const trellis = getTrellis();
  const understoodMetadataKeys = ["name", "serialNumber", "modelNumber"] as const;
  const understoodMetadataKeySet = new Set<string>(understoodMetadataKeys);

  function actionPath(path: string): string {
    return `${base}${path}`;
  }

  let loading = $state(true);
  let error = $state<string | null>(null);
  let activeTab = $state<Tab>("deployments");

  let deployments = $state.raw<DeviceDeployment[]>([]);
  let instances = $state.raw<DeviceInstance[]>([]);
  let activations = $state.raw<Activation[]>([]);
  let reviews = $state.raw<Review[]>([]);

  let deploymentSearch = $state("");
  let deploymentStatus = $state<DeploymentStatus>("all");
  let deploymentFilter = $state("");
  let instanceSearch = $state("");
  let instanceState = $state<InstanceState>("all");
  let activationState = $state<ActivationState>("all");
  let reviewState = $state<ReviewState>("all");
  let showMetadata = $state(false);
  let selectedReviewId = $state<string | null>(null);

  const instancesById = $derived.by(() => new Map(instances.map((instance) => [instance.instanceId, instance])));
  const metrics = $derived([
    { label: "Deployments", value: deployments.length, detail: `${deployments.filter((deployment) => !deployment.disabled).length} active` },
    { label: "Instances", value: instances.length, detail: `${instances.filter((instance) => instance.state === "activated").length} activated` },
    { label: "Activations", value: activations.length, detail: `${activations.filter((activation) => activation.state === "revoked").length} revoked` },
    { label: "Reviews", value: reviews.length, detail: `${reviews.filter((review) => review.state === "pending").length} pending` },
  ]);

  const filteredDeployments = $derived.by(() => {
    const term = deploymentSearch.trim().toLowerCase();
    return deployments.filter((deployment) => {
      if (deploymentStatus === "active" && deployment.disabled) return false;
      if (deploymentStatus === "disabled" && !deployment.disabled) return false;
      return !term || deployment.deploymentId.toLowerCase().includes(term) || (deployment.reviewMode ?? "").toLowerCase().includes(term);
    });
  });

  const filteredInstances = $derived.by(() => {
    const term = instanceSearch.trim().toLowerCase();
    return instances.filter((instance) => {
      if (deploymentFilter && instance.deploymentId !== deploymentFilter) return false;
      if (instanceState !== "all" && instance.state !== instanceState) return false;
      return !term || instanceSearchText(instance).includes(term);
    });
  });

  const filteredActivations = $derived.by(() => {
    const term = instanceSearch.trim().toLowerCase();
    return activations.filter((activation) => {
      if (deploymentFilter && activation.deploymentId !== deploymentFilter) return false;
      if (activationState !== "all" && activation.state !== activationState) return false;
      return !term || activationSearchText(activation).includes(term);
    });
  });

  const filteredReviews = $derived.by(() => {
    const term = instanceSearch.trim().toLowerCase();
    return reviews.filter((review) => {
      if (deploymentFilter && review.deploymentId !== deploymentFilter) return false;
      if (reviewState !== "all" && review.state !== reviewState) return false;
      return !term || reviewSearchText(review).includes(term);
    });
  });

  const selectedReview = $derived(filteredReviews.find((review) => review.reviewId === selectedReviewId) ?? filteredReviews[0] ?? null);

  async function load() {
    loading = true;
    error = null;
    try {
      const [deploymentsResponse, instancesResponse, activationsResponse, reviewsResponse] = await Promise.all([
        trellis.request("Auth.Deployments.List", { kind: "device", limit: 500, offset: 0 }).take(),
        trellis.request("Auth.Devices.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.DeviceUserAuthorities.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.DeviceUserAuthorities.Reviews.List", { limit: 500, offset: 0 }).take(),
      ]);

      if (isErr(deploymentsResponse)) { error = errorMessage(deploymentsResponse); return; }
      if (isErr(instancesResponse)) { error = errorMessage(instancesResponse); return; }
      if (isErr(activationsResponse)) { error = errorMessage(activationsResponse); return; }
      if (isErr(reviewsResponse)) { error = errorMessage(reviewsResponse); return; }

      deployments = (deploymentsResponse.entries ?? []).filter((deployment): deployment is DeviceDeployment => deployment.kind === "device");
      instances = instancesResponse.entries ?? [];
      activations = activationsResponse.entries ?? [];
      reviews = reviewsResponse.entries ?? [];
      if (selectedReviewId && !reviews.some((review) => review.reviewId === selectedReviewId)) {
        selectedReviewId = null;
      }
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  function setActiveTab(tab: Tab) {
    activeTab = tab;
  }

  function clearFilters() {
    deploymentSearch = "";
    deploymentStatus = "all";
    deploymentFilter = "";
    instanceSearch = "";
    instanceState = "all";
    activationState = "all";
    reviewState = "all";
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

  function metadataValue(instanceId: string, key: (typeof understoodMetadataKeys)[number]): string | null {
    return instancesById.get(instanceId)?.metadata?.[key] ?? null;
  }

  function metadataEntries(instanceId: string): Array<[string, string]> {
    return Object.entries(instancesById.get(instanceId)?.metadata ?? {}).filter(([key]) => !understoodMetadataKeySet.has(key));
  }

  function instanceSearchText(instance: DeviceInstance): string {
    return [instance.instanceId, instance.publicIdentityKey, instance.deploymentId, instance.state, ...Object.values(instance.metadata ?? {})].join(" ").toLowerCase();
  }

  function activationSearchText(activation: Activation): string {
    const instance = instancesById.get(activation.instanceId);
    return [activation.instanceId, activation.publicIdentityKey, activation.deploymentId, activation.state, ...Object.values(instance?.metadata ?? {})].join(" ").toLowerCase();
  }

  function reviewSearchText(review: Review): string {
    const instance = instancesById.get(review.instanceId);
    return [review.reviewId, review.instanceId, review.publicIdentityKey, review.deploymentId, review.state, review.reason ?? "", ...Object.values(instance?.metadata ?? {})].join(" ").toLowerCase();
  }

  function instanceRowKey(instance: DeviceInstance): string {
    return `${instance.instanceId}:${instance.createdAt}:${instance.publicIdentityKey}`;
  }

  function activationRowKey(activation: Activation): string {
    return `${activation.instanceId}:${activation.activatedAt}:${activation.revokedAt ?? ""}:${activation.state}`;
  }

  function formatActivatedBy(actor: Activation["activatedBy"]): string {
    return actor ? `${actor.participantKind}:${actor.identity.provider}:${actor.identity.subject}` : "—";
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
      <div class="trellis-filterbar-actions">
        <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
        <details class="dropdown dropdown-end">
          <summary class="btn btn-outline btn-sm">Actions <Icon name="chevronDown" size={14} /></summary>
          <ul class="menu dropdown-content trellis-dropdown-menu w-80">
            <li><a href={actionPath("/admin/devices/profiles/new")}>Create device deployment</a></li>
            <li><a href={actionPath("/admin/devices/profiles/disable")}>Disable device deployment</a></li>
            <li><a href={actionPath("/admin/devices/instances/provision")}>Provision device instance</a></li>
            <li><a href={actionPath("/admin/devices/instances/disable")}>Disable device instance</a></li>
            <li><a href={actionPath("/admin/devices/activations/revoke")}>Revoke activation</a></li>
            <li><a href={actionPath("/admin/devices/reviews/decide")}>Decide review</a></li>
          </ul>
        </details>
      </div>
    {/snippet}
  </PageToolbar>

  <InlineMetricsStrip {metrics} />

  <div class="tabs tabs-boxed w-fit">
    <button class={["tab", activeTab === "deployments" && "tab-active"]} onclick={() => setActiveTab("deployments")}>Deployments</button>
    <button class={["tab", activeTab === "instances" && "tab-active"]} onclick={() => setActiveTab("instances")}>Instances</button>
    <button class={["tab", activeTab === "activations" && "tab-active"]} onclick={() => setActiveTab("activations")}>Activations</button>
    <button class={["tab", activeTab === "reviews" && "tab-active"]} onclick={() => setActiveTab("reviews")}>Reviews</button>
  </div>

  <Panel title="Filters" eyebrow="Controls">
    <form
      class="trellis-filterbar"
      onsubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div class="trellis-filterbar-controls">
        {#if activeTab === "deployments"}
          <label class="trellis-field w-full sm:w-72">
            <span class="trellis-field-label">Deployment</span>
            <input class="input input-bordered input-sm" bind:value={deploymentSearch} placeholder="Deployment or review mode…" />
          </label>
          <label class="trellis-field w-full sm:w-44">
            <span class="trellis-field-label">Status</span>
            <select class="select select-bordered select-sm" bind:value={deploymentStatus}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
        {:else}
          <label class="trellis-field w-full sm:w-60">
            <span class="trellis-field-label">Deployment</span>
            <select class="select select-bordered select-sm" bind:value={deploymentFilter}>
              <option value="">All deployments</option>
              {#each deployments as deployment (deployment.deploymentId)}
                <option value={deployment.deploymentId}>{deployment.deploymentId}</option>
              {/each}
            </select>
          </label>
          <label class="trellis-field w-full sm:w-64">
            <span class="trellis-field-label">Instance / identity</span>
            <input class="input input-bordered input-sm" bind:value={instanceSearch} placeholder="Instance, key, metadata…" />
          </label>
          {#if activeTab === "instances"}
            <label class="trellis-field w-full sm:w-44">
              <span class="trellis-field-label">State</span>
              <select class="select select-bordered select-sm" bind:value={instanceState}>
                <option value="all">All</option>
                <option value="registered">Registered</option>
                <option value="activated">Activated</option>
                <option value="revoked">Revoked</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
          {:else if activeTab === "activations"}
            <label class="trellis-field w-full sm:w-44">
              <span class="trellis-field-label">State</span>
              <select class="select select-bordered select-sm" bind:value={activationState}>
                <option value="all">All</option>
                <option value="activated">Activated</option>
                <option value="revoked">Revoked</option>
              </select>
            </label>
          {:else}
            <label class="trellis-field w-full sm:w-44">
              <span class="trellis-field-label">State</span>
              <select class="select select-bordered select-sm" bind:value={reviewState}>
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
          {/if}
        {/if}
      </div>
      <div class="trellis-filterbar-actions">
        {#if activeTab === "instances" || activeTab === "activations" || activeTab === "reviews"}
          <label class="label cursor-pointer gap-2 py-0">
            <span class="label-text text-sm">Metadata</span>
            <input class="toggle toggle-sm" type="checkbox" bind:checked={showMetadata} />
          </label>
        {/if}
        <button type="button" class="btn btn-ghost btn-sm" onclick={clearFilters}>Clear</button>
      </div>
    </form>
  </Panel>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading device control surface" /></Panel>
  {:else if activeTab === "deployments"}
    <Panel title="Deployments" eyebrow="Primary table">
      {#if filteredDeployments.length === 0}
        <EmptyState title="No device deployments" description="No device deployments match the current filters." />
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm trellis-table">
            <thead>
              <tr>
                <th>Deployment</th>
                <th>Review</th>
                <th>Instances</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each filteredDeployments as deployment (deployment.deploymentId)}
                {@const deploymentInstances = instances.filter((instance) => instance.deploymentId === deployment.deploymentId)}
                <tr>
                  <td class="trellis-identifier font-medium">{deployment.deploymentId}</td>
                  <td class="text-base-content/60">{deployment.reviewMode ?? "none"}</td>
                  <td class="text-base-content/60">{deploymentInstances.filter((instance) => instance.state === "activated").length} active / {deploymentInstances.length} total</td>
                  <td><StatusBadge label={deployment.disabled ? "Disabled" : "Active"} status={statusForDisabled(deployment.disabled)} /></td>
                  <td class="text-right">
                    {#if deployment.disabled}
                      <span class="text-xs text-base-content/40">—</span>
                    {:else}
                      <a class="btn btn-ghost btn-xs text-error" href={actionPath(`/admin/devices/profiles/disable?deployment=${encodeURIComponent(deployment.deploymentId)}`)}>Disable</a>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      {#snippet footer()}{filteredDeployments.length} deployment{filteredDeployments.length !== 1 ? "s" : ""}{/snippet}
    </Panel>
  {:else if activeTab === "instances"}
    <Panel title="Instances" eyebrow="Primary table">
      {#if filteredInstances.length === 0}
        <EmptyState title="No device instances" description="No provisioned devices match the current filters." />
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm trellis-table">
            <thead>
              <tr>
                <th>Instance</th>
                <th>Deployment</th>
                <th>Identity Key</th>
                <th>Name</th>
                <th>Serial</th>
                <th>Model</th>
                {#if showMetadata}<th>Metadata</th>{/if}
                <th>State</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each filteredInstances as instance (instanceRowKey(instance))}
                <tr>
                  <td class="trellis-identifier font-medium">{instance.instanceId}</td>
                  <td class="trellis-identifier text-base-content/60">{instance.deploymentId}</td>
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
                  <td class="text-right">
                    {#if instance.state === "disabled"}
                      <span class="text-xs text-base-content/40">—</span>
                    {:else}
                      <a class="btn btn-ghost btn-xs text-error" href={actionPath(`/admin/devices/instances/disable?instance=${encodeURIComponent(instance.instanceId)}`)}>Disable</a>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      {#snippet footer()}{filteredInstances.length} instance{filteredInstances.length !== 1 ? "s" : ""}{/snippet}
    </Panel>
  {:else if activeTab === "activations"}
    <Panel title="Activations" eyebrow="Primary table">
      {#if filteredActivations.length === 0}
        <EmptyState title="No device activations" description="No activations match the current filters." />
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm trellis-table">
            <thead>
              <tr>
                <th>Instance</th>
                <th>Deployment</th>
                <th>Activated By</th>
                <th>State</th>
                <th>Activated</th>
                <th>Revoked</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each filteredActivations as activation (activationRowKey(activation))}
                <tr>
                  <td>
                    <div class="trellis-identifier font-medium">{activation.instanceId}</div>
                    <div class="trellis-identifier text-base-content/60">{activation.publicIdentityKey}</div>
                    <div class="mt-1 text-xs text-base-content/60">
                      {metadataValue(activation.instanceId, "name") ?? "Unnamed"} · {metadataValue(activation.instanceId, "serialNumber") ?? "no serial"}
                    </div>
                    {#if showMetadata}
                      <div class="mt-2 space-y-1 text-xs text-base-content/60">
                        {#if metadataEntries(activation.instanceId).length > 0}
                          {#each metadataEntries(activation.instanceId) as [key, value] (key)}
                            <div><span class="font-medium text-base-content">{key}</span>=<span class="trellis-identifier">{value}</span></div>
                          {/each}
                        {:else}
                          <div>No opaque metadata.</div>
                        {/if}
                      </div>
                    {/if}
                  </td>
                  <td class="trellis-identifier text-base-content/60">{activation.deploymentId}</td>
                  <td class="text-base-content/60">{formatActivatedBy(activation.activatedBy)}</td>
                  <td><StatusBadge label={activation.state} status={activationStatus(activation.state)} /></td>
                  <td class="text-base-content/60">{formatDate(activation.activatedAt)}</td>
                  <td class="text-base-content/60">{activation.revokedAt ? formatDate(activation.revokedAt) : "—"}</td>
                  <td class="text-right">
                    {#if activation.state === "revoked"}
                      <span class="text-xs text-base-content/40">—</span>
                    {:else}
                      <a class="btn btn-ghost btn-xs text-error" href={actionPath(`/admin/devices/activations/revoke?instance=${encodeURIComponent(activation.instanceId)}`)}>Revoke</a>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      {#snippet footer()}{filteredActivations.length} activation{filteredActivations.length !== 1 ? "s" : ""}{/snippet}
    </Panel>
  {:else}
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <Panel title="Reviews" eyebrow="Primary table" class="min-w-0">
        {#if filteredReviews.length === 0}
          <EmptyState title="No device reviews" description="No activation reviews match the current filters." />
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-sm trellis-table">
              <thead>
                <tr>
                  <th>Review</th>
                  <th>Instance</th>
                  <th>Deployment</th>
                  <th>State</th>
                  <th>Requested</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each filteredReviews as review (review.reviewId)}
                  <tr class={{ "bg-base-200/60": selectedReview?.reviewId === review.reviewId }}>
                    <td><button class="trellis-identifier text-left hover:underline" onclick={() => (selectedReviewId = review.reviewId)}>{review.reviewId}</button></td>
                    <td>
                      <div class="trellis-identifier">{review.instanceId}</div>
                      <div class="trellis-identifier text-base-content/60">{review.publicIdentityKey}</div>
                    </td>
                    <td class="trellis-identifier text-base-content/60">{review.deploymentId}</td>
                    <td><StatusBadge label={review.state} status={reviewStatus(review.state)} /></td>
                    <td class="text-base-content/60">{formatDate(review.requestedAt)}</td>
                    <td class="text-right">
                      {#if review.state === "pending"}
                        <a class="btn btn-ghost btn-xs" href={actionPath(`/admin/devices/reviews/decide?review=${encodeURIComponent(review.reviewId)}`)}>Decide</a>
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
        {#snippet footer()}{filteredReviews.length} review{filteredReviews.length !== 1 ? "s" : ""}{/snippet}
      </Panel>

      <Panel title="Review Detail" eyebrow="Secondary" class="min-w-0">
        {#if selectedReview}
          <div class="space-y-3 text-sm">
            <div class="flex items-center justify-between gap-3">
              <span class="trellis-identifier">{selectedReview.reviewId}</span>
              <StatusBadge label={selectedReview.state} status={reviewStatus(selectedReview.state)} />
            </div>
            <div>
              <p class="text-[0.65rem] font-semibold uppercase tracking-wider text-base-content/50">Instance</p>
              <p class="trellis-identifier">{selectedReview.instanceId}</p>
              <p class="trellis-identifier text-base-content/60">{selectedReview.publicIdentityKey}</p>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div><span class="text-base-content/50">Deployment</span><div class="trellis-identifier">{selectedReview.deploymentId}</div></div>
              <div><span class="text-base-content/50">Requested</span><div>{formatDate(selectedReview.requestedAt)}</div></div>
              <div><span class="text-base-content/50">Decided</span><div>{selectedReview.decidedAt ? formatDate(selectedReview.decidedAt) : "—"}</div></div>
              <div><span class="text-base-content/50">Reason</span><div>{selectedReview.reason ?? "—"}</div></div>
            </div>
            <div class="rounded-box border border-base-300 bg-base-200/40 p-3 text-xs text-base-content/60">
              Review decisions are not side notes: approving or rejecting this item completes the original device activation operation. Operators should decide here, and callers should observe the operation result rather than polling the review queue.
            </div>
            <div class="space-y-0.5 text-xs text-base-content/60">
              <div><span class="font-medium text-base-content">Name</span>: {metadataValue(selectedReview.instanceId, "name") ?? "—"}</div>
              <div><span class="font-medium text-base-content">Serial</span>: {metadataValue(selectedReview.instanceId, "serialNumber") ?? "—"}</div>
              <div><span class="font-medium text-base-content">Model</span>: {metadataValue(selectedReview.instanceId, "modelNumber") ?? "—"}</div>
            </div>
            {#if showMetadata}
              <div class="space-y-1 rounded-box border border-base-300 bg-base-200/40 p-3 text-xs text-base-content/60">
                {#if metadataEntries(selectedReview.instanceId).length > 0}
                  {#each metadataEntries(selectedReview.instanceId) as [key, value] (key)}
                    <div><span class="font-medium text-base-content">{key}</span>=<span class="trellis-identifier">{value}</span></div>
                  {/each}
                {:else}
                  <div>No opaque metadata.</div>
                {/if}
              </div>
            {/if}
          </div>
        {:else}
          <EmptyState title="Select a review" description="Choose a review from the list to inspect activation metadata and decision context." />
        {/if}
      </Panel>
    </div>
  {/if}
</section>
