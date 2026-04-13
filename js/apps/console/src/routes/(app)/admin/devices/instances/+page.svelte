<script lang="ts">
  import type {
    AuthDisableDeviceInstanceInput,
    AuthListDeviceInstancesInput,
    AuthListDeviceInstancesOutput,
    AuthListDeviceProfilesOutput,
    AuthProvisionDeviceInstanceInput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { isErr } from "@qlever-llc/result";
  import { onMount } from "svelte";
  import { errorMessage, formatDate } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  type Instance = AuthListDeviceInstancesOutput["instances"][number] & {
    metadata?: Record<string, string>;
  };
  type Profile = AuthListDeviceProfilesOutput["profiles"][number];
  type InstanceState = NonNullable<AuthListDeviceInstancesInput["state"]> | "all";
  type DeviceMetadata = Record<string, string>;

  const understoodMetadataKeys = ["name", "serialNumber", "modelNumber"] as const;

  const trellisPromise = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let createPending = $state(false);
  let disableTarget = $state<string | null>(null);

  let instances = $state<Instance[]>([]);
  let profiles = $state<Profile[]>([]);

  let profileFilter = $state("");
  let stateFilter = $state<InstanceState>("all");

  let provisionProfileId = $state("");
  let publicIdentityKey = $state("");
  let activationKey = $state("");
  let metadataName = $state("");
  let metadataSerialNumber = $state("");
  let metadataModelNumber = $state("");
  let opaqueMetadata = $state("");

  let showMetadata = $state(false);

  function instanceQuery(): AuthListDeviceInstancesInput {
    return {
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
      const [instancesResponse, profilesResponse] = await Promise.all([
        requestOrThrow<AuthListDeviceInstancesOutput>("Auth.ListDeviceInstances", instanceQuery()),
        requestOrThrow<AuthListDeviceProfilesOutput>("Auth.ListDeviceProfiles", {}),
      ]);

      instances = instancesResponse.instances ?? [];
      profiles = profilesResponse.profiles ?? [];
      if (!provisionProfileId && profilesResponse.profiles?.length) {
        provisionProfileId = profilesResponse.profiles[0]?.profileId ?? "";
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  function understoodMetadataValue(instance: Instance, key: (typeof understoodMetadataKeys)[number]): string | null {
    return instance.metadata?.[key] ?? null;
  }

  function opaqueMetadataEntries(metadata: Instance["metadata"]): Array<[string, string]> {
    return Object.entries(metadata ?? {}).filter(([key]) => !understoodMetadataKeys.includes(key as (typeof understoodMetadataKeys)[number])) as Array<[string, string]>;
  }

  function parseProvisionMetadata(): DeviceMetadata | undefined {
    const metadata: DeviceMetadata = {};

    const understoodEntries = [
      ["name", metadataName],
      ["serialNumber", metadataSerialNumber],
      ["modelNumber", metadataModelNumber],
    ] as const;

    for (const [key, rawValue] of understoodEntries) {
      const value = rawValue.trim();
      if (value) {
        metadata[key] = value;
      }
    }

    for (const [index, rawLine] of opaqueMetadata.split(/\r?\n/).entries()) {
      const line = rawLine.trim();
      if (!line) continue;

      const separatorIndex = line.indexOf("=");
      if (separatorIndex < 0) {
        throw new Error(`Metadata line ${index + 1} must be key=value.`);
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();

      if (!key || !value) {
        throw new Error(`Metadata line ${index + 1} must have a non-empty key and value.`);
      }
      if (key in metadata) {
        throw new Error(`Metadata key \"${key}\" is duplicated.`);
      }

      metadata[key] = value;
    }

    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  async function provisionInstance() {
    createPending = true;
    error = null;
    try {
      const metadata = parseProvisionMetadata();
      await requestOrThrow(
        "Auth.ProvisionDeviceInstance",
        {
          profileId: provisionProfileId,
          publicIdentityKey: publicIdentityKey.trim(),
          activationKey: activationKey.trim(),
          ...(metadata ? { metadata } : {}),
        } satisfies AuthProvisionDeviceInstanceInput,
      );
      notifications.success("Device instance provisioned.", "Provisioned");
      publicIdentityKey = "";
      activationKey = "";
      metadataName = "";
      metadataSerialNumber = "";
      metadataModelNumber = "";
      opaqueMetadata = "";
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      createPending = false;
    }
  }

  async function disableInstance(instance: Instance) {
    if (instance.state === "disabled") return;
    if (!window.confirm(`Disable device instance ${instance.instanceId}?`)) return;

    disableTarget = instance.instanceId;
    error = null;
    try {
      await requestOrThrow(
        "Auth.DisableDeviceInstance",
        { instanceId: instance.instanceId } satisfies AuthDisableDeviceInstanceInput,
      );
      notifications.success(`Device instance ${instance.instanceId} disabled.`, "Disabled");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      disableTarget = null;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <div class="card border border-base-300 bg-base-100">
    <div class="card-body gap-4">
      <div>
        <h2 class="card-title text-base">Provision device instance</h2>
        <p class="text-sm text-base-content/60">Register a known device identity under an existing device profile.</p>
      </div>

      <form class="grid gap-3 lg:grid-cols-[1fr_2fr_2fr]" onsubmit={(event) => { event.preventDefault(); void provisionInstance(); }}>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Profile</span>
          <select class="select select-bordered select-sm" bind:value={provisionProfileId} required>
            <option value="" disabled>Select a profile</option>
            {#each profiles as profile (profile.profileId)}
              <option value={profile.profileId} disabled={profile.disabled}>{profile.profileId}</option>
            {/each}
          </select>
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">Public identity key</span>
          <input class="input input-bordered input-sm font-mono" bind:value={publicIdentityKey} placeholder="base64url public key" required />
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">Activation key</span>
          <input class="input input-bordered input-sm font-mono" bind:value={activationKey} placeholder="base64url activation key" required />
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">Name</span>
          <input class="input input-bordered input-sm" bind:value={metadataName} placeholder="Optional display name" />
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">Serial number</span>
          <input class="input input-bordered input-sm" bind:value={metadataSerialNumber} placeholder="Optional serial" />
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">Model number</span>
          <input class="input input-bordered input-sm" bind:value={metadataModelNumber} placeholder="Optional model" />
        </label>

        <label class="form-control gap-1 lg:col-span-2">
          <span class="label-text text-xs">Metadata</span>
          <textarea
            class="textarea textarea-bordered textarea-sm min-h-24 font-mono"
            bind:value={opaqueMetadata}
            placeholder="assetTag=asset-42
location=front-desk"
          ></textarea>
        </label>

        <div class="flex items-end lg:justify-end">
          <button type="submit" class="btn btn-primary btn-sm" disabled={createPending || !provisionProfileId}>
            {createPending ? "Provisioning…" : "Provision"}
          </button>
        </div>
      </form>
    </div>
  </div>

  <div class="flex flex-wrap items-end justify-between gap-3">
    <form class="flex flex-wrap items-end gap-2" onsubmit={(event) => { event.preventDefault(); void load(); }}>
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
          <option value="registered">Registered</option>
          <option value="activated">Activated</option>
          <option value="revoked">Revoked</option>
          <option value="disabled">Disabled</option>
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
  {:else if instances.length === 0}
    <p class="text-sm text-base-content/60">No device instances found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Instance</th>
            <th>Profile</th>
            <th>Identity Key</th>
            <th>Name</th>
            <th>Serial</th>
            <th>Model</th>
            {#if showMetadata}
              <th>Metadata</th>
            {/if}
            <th>State</th>
            <th>Created</th>
            <th>Activated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each instances as instance (instance.instanceId)}
            <tr>
              <td class="font-medium">{instance.instanceId}</td>
              <td class="text-base-content/60">{instance.profileId}</td>
              <td class="font-mono text-xs text-base-content/60">{instance.publicIdentityKey}</td>
              <td class="text-base-content/60">{understoodMetadataValue(instance, "name") ?? "—"}</td>
              <td class="text-base-content/60">{understoodMetadataValue(instance, "serialNumber") ?? "—"}</td>
              <td class="text-base-content/60">{understoodMetadataValue(instance, "modelNumber") ?? "—"}</td>
              {#if showMetadata}
                <td class="text-xs text-base-content/60">
                  {#if opaqueMetadataEntries(instance.metadata).length > 0}
                    <div class="space-y-1">
                      {#each opaqueMetadataEntries(instance.metadata) as [key, value] (key)}
                        <div><span class="font-medium text-base-content">{key}</span>=<span class="font-mono">{value}</span></div>
                      {/each}
                    </div>
                  {:else}
                    —
                  {/if}
                </td>
              {/if}
              <td><span class="badge badge-sm">{instance.state}</span></td>
              <td class="text-base-content/60">{formatDate(instance.createdAt)}</td>
              <td class="text-base-content/60">{instance.activatedAt ? formatDate(instance.activatedAt) : "—"}</td>
              <td class="text-right">
                <button
                  class="btn btn-ghost btn-xs text-error"
                  onclick={() => disableInstance(instance)}
                  disabled={instance.state === "disabled" || disableTarget === instance.instanceId}
                >
                  {disableTarget === instance.instanceId ? "Disabling…" : "Disable"}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-base-content/50">{instances.length} instance{instances.length !== 1 ? "s" : ""}</p>
  {/if}
</section>
