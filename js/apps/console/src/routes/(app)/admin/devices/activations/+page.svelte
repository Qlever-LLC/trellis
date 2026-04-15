<script lang="ts">
  import type {
    AuthListDeviceActivationsInput,
    AuthListDeviceActivationsOutput,
    AuthListDeviceInstancesOutput,
    AuthListDeviceProfilesOutput,
    AuthRevokeDeviceActivationInput,
  } from "@qlever-llc/trellis-sdk/auth";
  import { isErr } from "@qlever-llc/result";
  import { onMount } from "svelte";
  import { errorMessage, formatDate } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  type Activation = AuthListDeviceActivationsOutput["activations"][number];
  type DeviceInstance = AuthListDeviceInstancesOutput["instances"][number] & {
    metadata?: Record<string, string>;
  };
  type Profile = AuthListDeviceProfilesOutput["profiles"][number];
  type ActivationState = NonNullable<AuthListDeviceActivationsInput["state"]> | "all";

  const understoodMetadataKeys = ["name", "serialNumber", "modelNumber"] as const;

  const trellisPromise = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let revokeTarget = $state<string | null>(null);

  let activations = $state<Activation[]>([]);
  let deviceInstances = $state<DeviceInstance[]>([]);
  let profiles = $state<Profile[]>([]);

  let instanceFilter = $state("");
  let profileFilter = $state("");
  let stateFilter = $state<ActivationState>("all");
  let showMetadata = $state(false);

  let deviceInstancesById = $derived.by(() => new Map(deviceInstances.map((instance) => [instance.instanceId, instance])));

  function activationQuery(): AuthListDeviceActivationsInput {
    return {
      instanceId: instanceFilter.trim() || undefined,
      profileId: profileFilter || undefined,
      state: stateFilter === "all" ? undefined : stateFilter,
    };
  }

  async function requestOrThrow<T>(method: string, input: unknown): Promise<T> {
    const trellis = await trellisPromise;
    const result = await trellis.request(method, input);
    const value = result.take();
    if (isErr(value)) throw value.error;
    return value as T;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [activationsResponse, instancesResponse, profilesResponse] = await Promise.all([
        requestOrThrow<AuthListDeviceActivationsOutput>("Auth.ListDeviceActivations", activationQuery()),
        requestOrThrow<AuthListDeviceInstancesOutput>("Auth.ListDeviceInstances", {}),
        requestOrThrow<AuthListDeviceProfilesOutput>("Auth.ListDeviceProfiles", {}),
      ]);

      activations = activationsResponse.activations ?? [];
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

  async function revokeActivation(activation: Activation) {
    if (activation.state === "revoked") return;
    if (!window.confirm(`Revoke activation for ${activation.instanceId}?`)) return;

    revokeTarget = activation.instanceId;
    error = null;
    try {
      await requestOrThrow(
        "Auth.RevokeDeviceActivation",
        { instanceId: activation.instanceId } satisfies AuthRevokeDeviceActivationInput,
      );
      notifications.success(`Device activation revoked for ${activation.instanceId}.`, "Revoked");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      revokeTarget = null;
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
          <option value="activated">Activated</option>
          <option value="revoked">Revoked</option>
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
  {:else if activations.length === 0}
    <p class="text-sm text-base-content/60">No device activations found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Instance</th>
            <th>Profile</th>
            <th>Activated By</th>
            <th>State</th>
            <th>Activated</th>
            <th>Revoked</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each activations as activation (activation.instanceId)}
            <tr>
              <td>
                <div class="font-medium">{activation.instanceId}</div>
                <div class="font-mono text-xs text-base-content/60">{activation.publicIdentityKey}</div>
                <div class="mt-1 space-y-0.5 text-xs text-base-content/60">
                  <div><span class="font-medium text-base-content">Name</span>: {understoodMetadataValue(activation.instanceId, "name") ?? "—"}</div>
                  <div><span class="font-medium text-base-content">Serial</span>: {understoodMetadataValue(activation.instanceId, "serialNumber") ?? "—"}</div>
                  <div><span class="font-medium text-base-content">Model</span>: {understoodMetadataValue(activation.instanceId, "modelNumber") ?? "—"}</div>
                </div>
                {#if showMetadata}
                  <div class="mt-2 space-y-1 text-xs text-base-content/60">
                    {#if opaqueMetadataEntries(activation.instanceId).length > 0}
                      {#each opaqueMetadataEntries(activation.instanceId) as [key, value] (key)}
                        <div><span class="font-medium text-base-content">{key}</span>=<span class="font-mono">{value}</span></div>
                      {/each}
                    {:else}
                      <div>—</div>
                    {/if}
                  </div>
                {/if}
              </td>
              <td class="text-base-content/60">{activation.profileId}</td>
              <td class="text-base-content/60">{activation.activatedBy ? `${activation.activatedBy.origin}:${activation.activatedBy.id}` : "—"}</td>
              <td><span class="badge badge-sm">{activation.state}</span></td>
              <td class="text-base-content/60">{formatDate(activation.activatedAt)}</td>
              <td class="text-base-content/60">{activation.revokedAt ? formatDate(activation.revokedAt) : "—"}</td>
              <td class="text-right">
                <button
                  class="btn btn-ghost btn-xs text-error"
                  onclick={() => revokeActivation(activation)}
                  disabled={activation.state === "revoked" || revokeTarget === activation.instanceId}
                >
                  {revokeTarget === activation.instanceId ? "Revoking…" : "Revoke"}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-base-content/50">{activations.length} activation{activations.length !== 1 ? "s" : ""}</p>
  {/if}
</section>
