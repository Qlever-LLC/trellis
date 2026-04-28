<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthListDeviceActivationReviewsInput,
    AuthListDeviceActivationReviewsOutput,
    AuthListDeviceInstancesOutput,
    AuthListDeviceDeploymentsOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "../../../../../lib/components/EmptyState.svelte";
  import Icon from "../../../../../lib/components/Icon.svelte";
  import InlineMetricsStrip from "../../../../../lib/components/InlineMetricsStrip.svelte";
  import LoadingState from "../../../../../lib/components/LoadingState.svelte";
  import PageToolbar from "../../../../../lib/components/PageToolbar.svelte";
  import Panel from "../../../../../lib/components/Panel.svelte";
  import StatusBadge from "../../../../../lib/components/StatusBadge.svelte";
  import { errorMessage, formatDate } from "../../../../../lib/format";
  import { getTrellis } from "../../../../../lib/trellis";

  type Review = AuthListDeviceActivationReviewsOutput["reviews"][number];
  type DeviceInstance = AuthListDeviceInstancesOutput["instances"][number] & {
    metadata?: Record<string, string>;
  };
  type Deployment = AuthListDeviceDeploymentsOutput["deployments"][number];
  type ReviewState = NonNullable<AuthListDeviceActivationReviewsInput["state"]> | "all";

  const understoodMetadataKeys = ["name", "serialNumber", "modelNumber"] as const;

  const trellis = getTrellis();

  let loading = $state(true);
  let error = $state<string | null>(null);

  let reviews = $state<Review[]>([]);
  let deviceInstances = $state<DeviceInstance[]>([]);
  let deployments = $state<Deployment[]>([]);

  let instanceFilter = $state("");
  let deploymentFilter = $state("");
  let stateFilter = $state<ReviewState>("all");
  let showMetadata = $state(false);
  let selectedReviewId = $state<string | null>(null);

  let deviceInstancesById = $derived.by(() => new Map(deviceInstances.map((instance) => [instance.instanceId, instance])));
  let selectedReview = $derived(reviews.find((review) => review.reviewId === selectedReviewId) ?? reviews[0] ?? null);
  const pendingCount = $derived(reviews.filter((review) => review.state === "pending").length);
  const approvedCount = $derived(reviews.filter((review) => review.state === "approved").length);
  const rejectedCount = $derived(reviews.filter((review) => review.state === "rejected").length);
  const metrics = $derived([
    { label: "Reviews", value: reviews.length, detail: stateFilter === "all" ? "All states" : stateFilter },
    { label: "Pending", value: pendingCount, detail: "Awaiting decision" },
    { label: "Approved", value: approvedCount, detail: "Accepted activations" },
    { label: "Rejected", value: rejectedCount, detail: "Denied activations" },
  ]);

  function reviewQuery(): AuthListDeviceActivationReviewsInput {
    return {
      instanceId: instanceFilter.trim() || undefined,
      deploymentId: deploymentFilter || undefined,
      state: stateFilter === "all" ? undefined : stateFilter,
    };
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [reviewsResponse, instancesResponse, deploymentsResponse] = await Promise.all([
        trellis.request("Auth.ListDeviceActivationReviews", reviewQuery()).take(),
        trellis.request("Auth.ListDeviceInstances", {}).take(),
        trellis.request("Auth.ListDeviceDeployments", {}).take(),
      ]);
      if (isErr(reviewsResponse)) { error = errorMessage(reviewsResponse); return; }
      if (isErr(instancesResponse)) { error = errorMessage(instancesResponse); return; }
      if (isErr(deploymentsResponse)) { error = errorMessage(deploymentsResponse); return; }

      reviews = reviewsResponse.reviews ?? [];
      deviceInstances = instancesResponse.instances ?? [];
      deployments = deploymentsResponse.deployments ?? [];
      if (selectedReviewId && !reviews.some((review) => review.reviewId === selectedReviewId)) {
        selectedReviewId = null;
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  function understoodMetadataValue(instanceId: string, key: (typeof understoodMetadataKeys)[number]): string | null {
    return deviceInstancesById.get(instanceId)?.metadata?.[key] ?? null;
  }

  function opaqueMetadataEntries(instanceId: string): Array<[string, string]> {
    return Object.entries(deviceInstancesById.get(instanceId)?.metadata ?? {}).filter(
      ([key]) => !understoodMetadataKeys.includes(key as (typeof understoodMetadataKeys)[number]),
    ) as Array<[string, string]>;
  }

  function reviewStatus(state: Review["state"]): "healthy" | "degraded" | "unhealthy" | "offline" {
    switch (state) {
      case "approved":
        return "healthy";
      case "pending":
        return "degraded";
      case "rejected":
        return "unhealthy";
      default:
        return "offline";
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Device reviews" description="Activation review queue. Decisions resolve the original activation operation for each device.">
    {#snippet actions()}
      <details class="dropdown dropdown-end">
        <summary class="btn btn-outline btn-sm">Actions <Icon name="chevronDown" size={14} /></summary>
        <ul class="menu dropdown-content z-10 mt-2 w-72 rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
          <li><a href={resolve("/admin/devices/reviews/decide")}>Decide activation review</a></li>
        </ul>
      </details>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  <Panel title="Review Controls" eyebrow="Filters">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <form class="flex flex-wrap items-end gap-2" onsubmit={(event) => { event.preventDefault(); void load(); }}>
      <label class="form-control gap-1">
        <span class="label-text text-xs">Instance</span>
        <input class="input input-bordered input-sm w-52" bind:value={instanceFilter} placeholder="Any instance" />
      </label>

      <label class="form-control gap-1">
        <span class="label-text text-xs">Deployment</span>
        <select class="select select-bordered select-sm w-48" bind:value={deploymentFilter}>
          <option value="">All deployments</option>
          {#each deployments as deployment (deployment.deploymentId)}
            <option value={deployment.deploymentId}>{deployment.deploymentId}</option>
          {/each}
        </select>
      </label>

      <label class="form-control gap-1">
        <span class="label-text text-xs">State</span>
        <select class="select select-bordered select-sm w-40" bind:value={stateFilter}>
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </label>

      <button type="submit" class="btn btn-outline btn-sm" disabled={loading}>Apply</button>
      </form>

      <div class="flex items-center gap-3">
        <label class="label cursor-pointer gap-2 py-0">
          <span class="label-text text-sm">Show metadata</span>
          <input class="toggle toggle-sm" type="checkbox" bind:checked={showMetadata} />
        </label>

      </div>
    </div>
  </Panel>

  <InlineMetricsStrip {metrics} />

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <LoadingState label="Loading device reviews" />
  {:else if reviews.length === 0}
    <Panel title="Review List" eyebrow="Primary">
      <EmptyState title="No device reviews found" description="No activation reviews match the current filters." />
    </Panel>
  {:else}
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <Panel title="Review List" eyebrow="Primary" class="min-w-0">
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
              {#each reviews as review (review.reviewId)}
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
        {#snippet footer()}
          {reviews.length} review{reviews.length !== 1 ? "s" : ""}
        {/snippet}
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
            </div>
            <div class="rounded-box border border-base-300 bg-base-200/40 p-3 text-xs text-base-content/60">
              Approving or rejecting this review completes the activation operation that created it; callers should wait on that operation rather than poll this queue.
            </div>
            <div class="space-y-0.5 text-xs text-base-content/60">
              <div><span class="font-medium text-base-content">Name</span>: {understoodMetadataValue(selectedReview.instanceId, "name") ?? "—"}</div>
              <div><span class="font-medium text-base-content">Serial</span>: {understoodMetadataValue(selectedReview.instanceId, "serialNumber") ?? "—"}</div>
              <div><span class="font-medium text-base-content">Model</span>: {understoodMetadataValue(selectedReview.instanceId, "modelNumber") ?? "—"}</div>
            </div>
            {#if showMetadata}
              <div class="space-y-1 rounded-box border border-base-300 bg-base-200/40 p-3 text-xs text-base-content/60">
                {#if opaqueMetadataEntries(selectedReview.instanceId).length > 0}
                  {#each opaqueMetadataEntries(selectedReview.instanceId) as [key, value] (key)}
                    <div><span class="font-medium text-base-content">{key}</span>=<span class="trellis-identifier">{value}</span></div>
                  {/each}
                {:else}
                  <div>No opaque metadata.</div>
                {/if}
              </div>
            {/if}
            <div><span class="text-base-content/50">Reason</span><p class="text-base-content/70">{selectedReview.reason ?? "—"}</p></div>
          </div>
        {:else}
          <EmptyState title="Select a review" description="Choose a review from the list to inspect activation metadata." />
        {/if}
      </Panel>
    </div>
  {/if}
</section>
