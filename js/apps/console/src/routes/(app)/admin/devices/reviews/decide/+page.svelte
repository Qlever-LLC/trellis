<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthDecideDeviceActivationReviewInput,
    AuthListDeviceActivationReviewsInput,
    AuthListDeviceActivationReviewsOutput,
    AuthListDeviceInstancesOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getNotifications } from "$lib/notifications.svelte";
  import { getTrellis } from "$lib/trellis";

  type Review = AuthListDeviceActivationReviewsOutput["reviews"][number];
  type DeviceInstance = AuthListDeviceInstancesOutput["instances"][number] & { metadata?: Record<string, string> };

  const understoodMetadataKeys = ["name", "serialNumber", "modelNumber"] as const;
  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let pending = $state(false);
  let reviews = $state<Review[]>([]);
  let deviceInstances = $state<DeviceInstance[]>([]);
  let selectedReviewId = $state(page.url.searchParams.get("review") ?? "");
  let decision = $state<"approve" | "reject">("approve");
  let reason = $state("");
  let showMetadata = $state(false);

  const pendingReviews = $derived(reviews.filter((review) => review.state === "pending"));
  const selectedReview = $derived(pendingReviews.find((review) => review.reviewId === selectedReviewId) ?? null);
  const deviceInstancesById = $derived.by(() => new Map(deviceInstances.map((instance) => [instance.instanceId, instance])));

  function reviewStatus(state: Review["state"]): "healthy" | "degraded" | "unhealthy" | "offline" {
    return state === "pending" ? "degraded" : state === "approved" ? "healthy" : state === "rejected" ? "unhealthy" : "offline";
  }

  function understoodMetadataValue(instanceId: string, key: (typeof understoodMetadataKeys)[number]): string | null {
    return deviceInstancesById.get(instanceId)?.metadata?.[key] ?? null;
  }

  function opaqueMetadataEntries(instanceId: string): Array<[string, string]> {
    return Object.entries(deviceInstancesById.get(instanceId)?.metadata ?? {}).filter(
      ([key]) => !understoodMetadataKeys.includes(key as (typeof understoodMetadataKeys)[number]),
    ) as Array<[string, string]>;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [reviewsResponse, instancesResponse] = await Promise.all([
        trellis.request("Auth.ListDeviceActivationReviews", { state: "pending" }).take(),
        trellis.request("Auth.ListDeviceInstances", {}).take(),
      ]);
      if (isErr(reviewsResponse)) { error = errorMessage(reviewsResponse); return; }
      if (isErr(instancesResponse)) { error = errorMessage(instancesResponse); return; }
      const loadedReviews = reviewsResponse.reviews ?? [];
      const loadedPendingReviews = loadedReviews.filter((review) => review.state === "pending");
      reviews = loadedReviews;
      deviceInstances = instancesResponse.instances ?? [];
      if (selectedReviewId && !loadedPendingReviews.some((review) => review.reviewId === selectedReviewId)) {
        selectedReviewId = "";
      }
      if (!selectedReviewId && loadedPendingReviews.length) {
        selectedReviewId = loadedPendingReviews[0]?.reviewId ?? "";
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function decideReview() {
    if (!selectedReview) return;
    pending = true;
    error = null;
    try {
      const response = await trellis.request(
        "Auth.DecideDeviceActivationReview",
        {
          reviewId: selectedReview.reviewId,
          decision,
          ...(decision === "reject" && reason.trim() ? { reason: reason.trim() } : {}),
        } satisfies AuthDecideDeviceActivationReviewInput,
      ).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Review ${selectedReview.reviewId} ${decision === "approve" ? "approved" : "rejected"}.`, decision === "approve" ? "Approved" : "Rejected");
      reason = "";
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
  <PageToolbar title="Decide activation review" description="Approve or reject a pending review and complete the original activation operation.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/devices/reviews")}>Back to reviews</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading pending reviews" /></Panel>
  {:else if pendingReviews.length === 0}
    <EmptyState title="No pending reviews" description="There are no pending activation reviews to decide." />
  {:else}
    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <Panel title="Decision" eyebrow="Review workflow">
        <div class="mb-4 rounded-box border border-base-300 bg-base-200/40 p-3 text-xs text-base-content/60">
          The decision RPC resolves the activation operation that created this review. Retry a decision only with the same terminal result.
        </div>
        <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); void decideReview(); }}>
          <label class="form-control gap-1">
            <span class="label-text text-xs">Review</span>
            <select class="select select-bordered select-sm" bind:value={selectedReviewId} required>
              {#each pendingReviews as review (review.reviewId)}
                <option value={review.reviewId}>{review.reviewId} · {review.deploymentId}</option>
              {/each}
            </select>
          </label>

          <label class="form-control gap-1">
            <span class="label-text text-xs">Decision</span>
            <select class="select select-bordered select-sm" bind:value={decision}>
              <option value="approve">Approve</option>
              <option value="reject">Reject</option>
            </select>
          </label>

          <label class="form-control gap-1">
            <span class="label-text text-xs">Reason</span>
            <textarea class="textarea textarea-bordered textarea-sm min-h-24" bind:value={reason} placeholder="Optional decision reason"></textarea>
          </label>

          <div class="flex justify-end">
            <button type="submit" class={["btn btn-sm", decision === "approve" ? "btn-outline" : "btn-error"]} disabled={pending || !selectedReview}>
              {pending ? "Submitting…" : decision === "approve" ? "Approve review" : "Reject review"}
            </button>
          </div>
        </form>
      </Panel>

      <Panel title="Review detail" eyebrow="Selected review" class="min-w-0">
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
            <div class="space-y-0.5 text-xs text-base-content/60">
              <div><span class="font-medium text-base-content">Name</span>: {understoodMetadataValue(selectedReview.instanceId, "name") ?? "—"}</div>
              <div><span class="font-medium text-base-content">Serial</span>: {understoodMetadataValue(selectedReview.instanceId, "serialNumber") ?? "—"}</div>
              <div><span class="font-medium text-base-content">Model</span>: {understoodMetadataValue(selectedReview.instanceId, "modelNumber") ?? "—"}</div>
            </div>
            <label class="label cursor-pointer justify-start gap-2 py-0">
              <input class="toggle toggle-sm" type="checkbox" bind:checked={showMetadata} />
              <span class="label-text text-sm">Show metadata</span>
            </label>
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
          </div>
        {/if}
      </Panel>
    </div>
  {/if}
</section>
