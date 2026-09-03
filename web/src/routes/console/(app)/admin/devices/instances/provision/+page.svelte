<script lang="ts">
  import { ulid } from "ulid";
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthDeploymentsListOutput,
    AuthDevicesProvisionInput,
  } from "@trellis/apis/trellis.auth";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "$lib/format";
  import { getNotifications } from "$lib/notifications.svelte";
  import { getTrellis } from "$lib/trellis";

  type Deployment = AuthDeploymentsListOutput["entries"][number];
  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let pending = $state(false);
  let deployments = $state<Deployment[]>([]);
  let provisionDeploymentId = $state("");
  let instanceId = $state("");
  let identityPublicKey = $state("");
  let provisioningSecret = $state<string | null>(null);

  const activeDeployments = $derived(deployments.filter((deployment) => deployment.state === "active"));

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await trellis.authDeploymentsList({ kind: "device", limit: 100 }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      const loadedDeployments = (response.entries ?? []).filter((deployment): deployment is Deployment => deployment.kind === "device");
      const loadedActiveDeployments = loadedDeployments.filter((deployment) => deployment.state === "active");
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

  async function provisionInstance() {
    pending = true;
    error = null;
    try {
      const response = await trellis.authDevicesProvision({
        deploymentId: provisionDeploymentId,
        idempotencyKey: ulid(),
        instanceId: instanceId.trim() || null,
        identityPublicKey: identityPublicKey.trim() || null,
        participantId: null,
      } satisfies AuthDevicesProvisionInput,
      ).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success("Device instance provisioned.", "Provisioned");
      provisioningSecret = response.provisioningSecret;
      instanceId = "";
      identityPublicKey = "";
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
  <PageToolbar title="Provision device instance" description="Create a device identity and one-time provisioning secret.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href="/admin/devices">Back to devices</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <Notice variant="error">{error}</Notice>
  {/if}

  {#if provisioningSecret}
    <Notice variant="success">
      <strong>Provisioning secret:</strong>
      <code class="ml-2 break-all select-all">{provisioningSecret}</code>
      <span class="ml-2">Store it now. Trellis will not show it again.</span>
    </Notice>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading device deployments" /></Panel>
  {:else if activeDeployments.length === 0}
    <EmptyState title="No active deployments" description="Create or enable a deployment before provisioning device instances." />
  {:else}
    <Panel title="Instance identity" eyebrow="Device identity">
      <form class="trellis-form" onsubmit={(event) => { event.preventDefault(); void provisionInstance(); }}>
        <div class="trellis-record-summary">
          <div class="trellis-record-summary-title">{instanceId.trim() || "New device instance"}</div>
          <div class="trellis-metadata">Deployment {provisionDeploymentId || "not selected"}</div>
          {#if identityPublicKey.trim()}
            <div class="trellis-identifier break-all">{identityPublicKey.trim()}</div>
          {/if}
        </div>

        <div class="trellis-form-grid">
          <label class="trellis-field trellis-form-wide">
            <span class="trellis-field-label">Deployment</span>
            <select class="select select-bordered select-sm" bind:value={provisionDeploymentId} required>
              {#each activeDeployments as deployment (deployment.deploymentId)}
                <option value={deployment.deploymentId}>{deployment.deploymentId}</option>
              {/each}
            </select>
          </label>

          <label class="trellis-field">
            <span class="trellis-field-label">Instance ID</span>
            <input class="input input-bordered input-sm font-mono" bind:value={instanceId} placeholder="Generated when omitted" />
          </label>

          <label class="trellis-field">
            <span class="trellis-field-label">Public identity key</span>
            <input class="input input-bordered input-sm font-mono" bind:value={identityPublicKey} placeholder="Generated by the device; optional" />
          </label>
        </div>

        <div class="trellis-action-row">
          <button type="submit" class="btn btn-primary btn-sm" disabled={pending || !provisionDeploymentId}>
            {pending ? "Provisioning…" : "Provision"}
          </button>
        </div>
      </form>
    </Panel>
  {/if}
</section>
