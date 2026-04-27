<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthListDeviceDeploymentsOutput,
    AuthProvisionDeviceInstanceInput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "$lib/format";
  import { getNotifications } from "$lib/notifications.svelte";
  import { getTrellis } from "$lib/trellis";

  type Deployment = AuthListDeviceDeploymentsOutput["deployments"][number];
  type DeviceMetadata = Record<string, string>;

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let pending = $state(false);
  let deployments = $state<Deployment[]>([]);
  let provisionDeploymentId = $state("");
  let publicIdentityKey = $state("");
  let activationKey = $state("");
  let metadataName = $state("");
  let metadataSerialNumber = $state("");
  let metadataModelNumber = $state("");
  let opaqueMetadata = $state("");

  const activeDeployments = $derived(deployments.filter((deployment) => !deployment.disabled));

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await trellis.request("Auth.ListDeviceDeployments", {}).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      const loadedDeployments = response.deployments ?? [];
      const loadedActiveDeployments = loadedDeployments.filter((deployment) => !deployment.disabled);
      deployments = loadedDeployments;
      if (!provisionDeploymentId && loadedActiveDeployments.length) {
        provisionDeploymentId = loadedActiveDeployments[0]?.deploymentId ?? "";
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
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
      if (value) metadata[key] = value;
    }

    for (const [index, rawLine] of opaqueMetadata.split(/\r?\n/).entries()) {
      const line = rawLine.trim();
      if (!line) continue;
      const separatorIndex = line.indexOf("=");
      if (separatorIndex < 0) throw new Error(`Metadata line ${index + 1} must be key=value.`);

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (!key || !value) throw new Error(`Metadata line ${index + 1} must have a non-empty key and value.`);
      if (key in metadata) throw new Error(`Metadata key "${key}" is duplicated.`);
      metadata[key] = value;
    }

    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  async function provisionInstance() {
    pending = true;
    error = null;
    try {
      const metadata = parseProvisionMetadata();
      const response = await trellis.request(
        "Auth.ProvisionDeviceInstance",
        {
          deploymentId: provisionDeploymentId,
          publicIdentityKey: publicIdentityKey.trim(),
          activationKey: activationKey.trim(),
          ...(metadata ? { metadata } : {}),
        } satisfies AuthProvisionDeviceInstanceInput,
      ).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success("Device instance provisioned.", "Provisioned");
      publicIdentityKey = "";
      activationKey = "";
      metadataName = "";
      metadataSerialNumber = "";
      metadataModelNumber = "";
      opaqueMetadata = "";
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
  <PageToolbar title="Provision device instance" description="Register a known device identity and activation key.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/devices/instances")}>Back to instances</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading device deployments" /></Panel>
  {:else if activeDeployments.length === 0}
    <EmptyState title="No active deployments" description="Create or enable a deployment before provisioning device instances." />
  {:else}
    <Panel title="Instance identity" eyebrow="Device identity">
      <form class="grid gap-3 lg:grid-cols-[1fr_2fr_2fr]" onsubmit={(event) => { event.preventDefault(); void provisionInstance(); }}>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Deployment</span>
          <select class="select select-bordered select-sm" bind:value={provisionDeploymentId} required>
            {#each activeDeployments as deployment (deployment.deploymentId)}
              <option value={deployment.deploymentId}>{deployment.deploymentId}</option>
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
          <textarea class="textarea textarea-bordered textarea-sm min-h-24 font-mono" bind:value={opaqueMetadata} placeholder="assetTag=asset-42&#10;location=front-desk"></textarea>
        </label>

        <div class="flex items-end lg:justify-end">
          <button type="submit" class="btn btn-outline btn-sm" disabled={pending || !provisionDeploymentId}>
            {pending ? "Provisioning…" : "Provision"}
          </button>
        </div>
      </form>
    </Panel>
  {/if}
</section>
