<script lang="ts">
  import type {
    AuthListServiceInstancesOutput,
    AuthListServiceProfilesOutput,
  } from "@qlever-llc/trellis-sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import { errorMessage, formatDate } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  type ServiceInstance = AuthListServiceInstancesOutput["instances"][number];
  type ServiceProfile = AuthListServiceProfilesOutput["profiles"][number];
  type DisabledFilter = "all" | "active" | "disabled";

  const trellisPromise = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let createPending = $state(false);
  let actionTarget = $state<string | null>(null);

  let instances = $state<ServiceInstance[]>([]);
  let profiles = $state<ServiceProfile[]>([]);

  let profileFilter = $state("");
  let disabledFilter = $state<DisabledFilter>("all");

  let provisionProfileId = $state("");
  let instanceKey = $state("");

  const provisionProfiles = $derived(profiles.filter((profile) => !profile.disabled));
  const canProvision = $derived(Boolean(provisionProfileId && instanceKey.trim() && !createPending));

  function query() {
    return {
      profileId: profileFilter || undefined,
      disabled: disabledFilter === "all" ? undefined : disabledFilter === "disabled",
    };
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const trellis = await trellisPromise;
      const [instancesRes, profilesRes] = await Promise.all([
        trellis.requestOrThrow<AuthListServiceInstancesOutput>("Auth.ListServiceInstances" as string, query()),
        trellis.requestOrThrow<AuthListServiceProfilesOutput>("Auth.ListServiceProfiles" as string, {}),
      ]);
      instances = instancesRes.instances ?? [];
      profiles = profilesRes.profiles ?? [];
      if (!provisionProfileId || !provisionProfiles.some((profile) => profile.profileId === provisionProfileId)) {
        provisionProfileId = provisionProfiles[0]?.profileId ?? "";
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function provisionInstance() {
    createPending = true;
    error = null;
    try {
      const trellis = await trellisPromise;
      await trellis.requestOrThrow<void>("Auth.ProvisionServiceInstance" as string, {
        profileId: provisionProfileId,
        instanceKey: instanceKey.trim(),
      });
      notifications.success("Service instance provisioned.", "Provisioned");
      instanceKey = "";
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      createPending = false;
    }
  }

  async function setInstanceDisabled(instance: ServiceInstance, disabled: boolean) {
    const verb = disabled ? "Disable" : "Enable";
    if (!window.confirm(`${verb} service instance ${instance.instanceId}?`)) return;
    actionTarget = instance.instanceId;
    error = null;
    try {
      const trellis = await trellisPromise;
      await trellis.requestOrThrow<void>((disabled ? "Auth.DisableServiceInstance" : "Auth.EnableServiceInstance") as string, {
        instanceId: instance.instanceId,
      });
      notifications.success(`Service instance ${instance.instanceId} ${disabled ? "disabled" : "enabled"}.`, disabled ? "Disabled" : "Enabled");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      actionTarget = null;
    }
  }

  async function removeInstance(instance: ServiceInstance) {
    if (!window.confirm(`Remove service instance ${instance.instanceId}?`)) return;
    actionTarget = `${instance.instanceId}:remove`;
    error = null;
    try {
      const trellis = await trellisPromise;
      await trellis.requestOrThrow<void>("Auth.RemoveServiceInstance" as string, { instanceId: instance.instanceId });
      notifications.success(`Service instance ${instance.instanceId} removed.`, "Removed");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      actionTarget = null;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <div class="card border border-base-300 bg-base-100">
    <div class="card-body gap-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="card-title text-base">Provision service instance</h2>
          <p class="text-sm text-base-content/60">Bind a runtime service key to an existing service profile.</p>
        </div>
        <a href={resolve("/admin/services")} class="btn btn-outline btn-sm">Back to Profiles</a>
      </div>

      <form class="grid gap-3 lg:grid-cols-[1fr_2fr_auto]" onsubmit={(event) => { event.preventDefault(); void provisionInstance(); }}>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Profile</span>
          <select class="select select-bordered select-sm" bind:value={provisionProfileId} required>
            <option value="" disabled>Select a profile</option>
            {#each provisionProfiles as profile (profile.profileId)}
              <option value={profile.profileId}>{profile.profileId}</option>
            {/each}
          </select>
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">Instance key</span>
          <input class="input input-bordered input-sm font-mono" bind:value={instanceKey} placeholder="base64url public key" required />
        </label>

        <div class="flex items-end">
          <button type="submit" class="btn btn-primary btn-sm" disabled={!canProvision}>
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
        <span class="label-text text-xs">Status</span>
        <select class="select select-bordered select-sm w-36" bind:value={disabledFilter}>
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
      </label>

      <button type="submit" class="btn btn-primary btn-sm" disabled={loading}>Apply</button>
    </form>

    <div class="flex items-center gap-3">
      <p class="text-xs text-base-content/60">{instances.length} instance{instances.length === 1 ? "" : "s"}</p>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    </div>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
  {:else if instances.length === 0}
    <p class="text-sm text-base-content/60">No service instances found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Instance</th>
            <th>Profile</th>
            <th>Contract</th>
            <th>Capabilities</th>
            <th>Status</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each instances as instance (instance.instanceId)}
            <tr>
              <td>
                <div class="font-medium">{instance.instanceId}</div>
                <div class="font-mono text-xs text-base-content/60 break-all">{instance.instanceKey}</div>
              </td>
              <td class="text-base-content/60">{instance.profileId}</td>
              <td>
                <div class="text-sm text-base-content/80">{instance.currentContractId ?? "—"}</div>
                <div class="font-mono text-xs text-base-content/60">{instance.currentContractDigest ?? "—"}</div>
              </td>
              <td>
                <div class="flex flex-wrap gap-1">
                  {#each instance.capabilities as capability (capability)}
                    <span class="badge badge-outline badge-xs">{capability}</span>
                  {:else}
                    <span class="text-base-content/60">—</span>
                  {/each}
                </div>
              </td>
              <td>
                {#if instance.disabled}
                  <span class="badge badge-ghost badge-sm">Disabled</span>
                {:else}
                  <span class="badge badge-success badge-sm">Active</span>
                {/if}
              </td>
              <td class="text-base-content/60">{formatDate(instance.createdAt)}</td>
              <td>
                <div class="flex flex-wrap justify-end gap-2">
                  <button
                    class="btn btn-ghost btn-xs"
                    onclick={() => setInstanceDisabled(instance, !instance.disabled)}
                    disabled={actionTarget === instance.instanceId}
                  >
                    {instance.disabled ? "Enable" : "Disable"}
                  </button>
                  <button
                    class="btn btn-ghost btn-xs text-error"
                    onclick={() => removeInstance(instance)}
                    disabled={actionTarget === `${instance.instanceId}:remove`}
                  >
                    Remove
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
