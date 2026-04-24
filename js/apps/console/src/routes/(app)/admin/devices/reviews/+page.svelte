<script lang="ts">
  import type {
    AuthDecideDeviceActivationReviewInput,
    AuthListDeviceActivationReviewsInput,
    AuthListDeviceActivationReviewsOutput,
    AuthListDeviceInstancesOutput,
    AuthListDeviceProfilesOutput,
  } from "@qlever-llc/trellis-sdk/auth";
  import { isErr } from "@qlever-llc/result";
  import { onMount } from "svelte";
  import { errorMessage, formatDate } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  type Review = AuthListDeviceActivationReviewsOutput["reviews"][number];
  type DeviceInstance = AuthListDeviceInstancesOutput["instances"][number] & {
    metadata?: Record<string, string>;
  };
  type Profile = AuthListDeviceProfilesOutput["profiles"][number];
  type ReviewState = NonNullable<AuthListDeviceActivationReviewsInput["state"]> | "all";

  const understoodMetadataKeys = ["name", "serialNumber", "modelNumber"] as const;

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let decisionTarget = $state<string | null>(null);

  let reviews = $state<Review[]>([]);
  let deviceInstances = $state<DeviceInstance[]>([]);
  let profiles = $state<Profile[]>([]);

  let instanceFilter = $state("");
  let profileFilter = $state("");
  let stateFilter = $state<ReviewState>("all");
  let showMetadata = $state(false);

  let deviceInstancesById = $derived.by(() => new Map(deviceInstances.map((instance) => [instance.instanceId, instance])));

  function reviewQuery(): AuthListDeviceActivationReviewsInput {
    return {
      instanceId: instanceFilter.trim() || undefined,
      profileId: profileFilter || undefined,
      state: stateFilter === "all" ? undefined : stateFilter,
    };
  }

  async function requestValue<T>(method: string, input: unknown): Promise<T> {
    const result = await trellis.request<T>(method, input);
    const value = result.take();
    if (isErr(value)) throw value.error;
    return value as T;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [reviewsResponse, instancesResponse, profilesResponse] = await Promise.all([
        requestValue<AuthListDeviceActivationReviewsOutput>("Auth.ListDeviceActivationReviews", reviewQuery()),
        requestValue<AuthListDeviceInstancesOutput>("Auth.ListDeviceInstances", {}),
        requestValue<AuthListDeviceProfilesOutput>("Auth.ListDeviceProfiles", {}),
      ]);

      reviews = reviewsResponse.reviews ?? [];
      deviceInstances = instancesResponse.instances ?? [];
      profiles = profilesResponse.profiles ?? [];
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

  async function approveReview(review: Review) {
    if (review.state !== "pending") return;
    if (!window.confirm(`Approve activation review ${review.reviewId}?`)) return;

    decisionTarget = review.reviewId;
    error = null;
    try {
      await requestValue(
        "Auth.DecideDeviceActivationReview",
        {
          reviewId: review.reviewId,
          decision: "approve",
        } satisfies AuthDecideDeviceActivationReviewInput,
      );
      notifications.success(`Review ${review.reviewId} approved.`, "Approved");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      decisionTarget = null;
    }
  }

  async function rejectReview(review: Review) {
    if (review.state !== "pending") return;
    const reason = window.prompt("Optional rejection reason", review.reason ?? "");
    if (reason === null) return;

    decisionTarget = review.reviewId;
    error = null;
    try {
      await requestValue(
        "Auth.DecideDeviceActivationReview",
        {
          reviewId: review.reviewId,
          decision: "reject",
          reason: reason.trim() || undefined,
        } satisfies AuthDecideDeviceActivationReviewInput,
      );
      notifications.success(`Review ${review.reviewId} rejected.`, "Rejected");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      decisionTarget = null;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <form class="flex flex-wrap items-end gap-2" onsubmit={(event) => { event.preventDefault(); void load(); }}>
      <label class="form-control gap-1">
        <span class="label-text text-xs">Instance</span>
        <input class="input input-bordered input-sm w-52" bind:value={instanceFilter} placeholder="Any instance" />
      </label>

      <label class="form-control gap-1">
        <span class="label-text text-xs">Profile</span>
        <select class="select select-bordered select-sm w-48" bind:value={profileFilter}>
          <option value="">All profiles</option>
          {#each profiles as profile (profile.profileId)}
            <option value={profile.profileId}>{profile.profileId}</option>
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

      <button type="submit" class="btn btn-primary btn-sm" disabled={loading}>Apply</button>
    </form>

    <div class="flex items-center gap-3">
      <label class="label cursor-pointer gap-2 py-0">
        <span class="label-text text-sm">Show metadata</span>
        <input class="toggle toggle-sm" type="checkbox" bind:checked={showMetadata} />
      </label>

      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    </div>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
  {:else if reviews.length === 0}
    <p class="text-sm text-base-content/60">No device reviews found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Review</th>
            <th>Instance</th>
            <th>Profile</th>
            <th>State</th>
            <th>Requested</th>
            <th>Reason</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each reviews as review (review.reviewId)}
            <tr>
              <td class="font-mono text-xs">{review.reviewId}</td>
              <td>
                <div class="font-medium">{review.instanceId}</div>
                <div class="font-mono text-xs text-base-content/60">{review.publicIdentityKey}</div>
                <div class="mt-1 space-y-0.5 text-xs text-base-content/60">
                  <div><span class="font-medium text-base-content">Name</span>: {understoodMetadataValue(review.instanceId, "name") ?? "—"}</div>
                  <div><span class="font-medium text-base-content">Serial</span>: {understoodMetadataValue(review.instanceId, "serialNumber") ?? "—"}</div>
                  <div><span class="font-medium text-base-content">Model</span>: {understoodMetadataValue(review.instanceId, "modelNumber") ?? "—"}</div>
                </div>
                {#if showMetadata}
                  <div class="mt-2 space-y-1 text-xs text-base-content/60">
                    {#if opaqueMetadataEntries(review.instanceId).length > 0}
                      {#each opaqueMetadataEntries(review.instanceId) as [key, value] (key)}
                        <div><span class="font-medium text-base-content">{key}</span>=<span class="font-mono">{value}</span></div>
                      {/each}
                    {:else}
                      <div>—</div>
                    {/if}
                  </div>
                {/if}
              </td>
              <td class="text-base-content/60">{review.profileId}</td>
              <td><span class="badge badge-sm">{review.state}</span></td>
              <td class="text-base-content/60">{formatDate(review.requestedAt)}</td>
              <td class="text-base-content/60">{review.reason ?? "—"}</td>
              <td class="text-right">
                <div class="flex justify-end gap-2">
                  <button
                    class="btn btn-success btn-xs"
                    onclick={() => approveReview(review)}
                    disabled={review.state !== "pending" || decisionTarget === review.reviewId}
                  >
                    {decisionTarget === review.reviewId ? "Working…" : "Approve"}
                  </button>
                  <button
                    class="btn btn-ghost btn-xs text-error"
                    onclick={() => rejectReview(review)}
                    disabled={review.state !== "pending" || decisionTarget === review.reviewId}
                  >
                    {decisionTarget === review.reviewId ? "Working…" : "Reject"}
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-base-content/50">{reviews.length} review{reviews.length !== 1 ? "s" : ""}</p>
  {/if}
</section>
