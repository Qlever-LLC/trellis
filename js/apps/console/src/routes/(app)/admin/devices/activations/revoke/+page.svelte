<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthListDeviceActivationsOutput,
    AuthRevokeDeviceActivationInput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getNotifications } from "$lib/notifications.svelte";
  import { getTrellis } from "$lib/trellis";

  type Activation = AuthListDeviceActivationsOutput["activations"][number];

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let pending = $state(false);
  let activations = $state<Activation[]>([]);
  let selectedInstanceId = $state(page.url.searchParams.get("instance") ?? "");

  const activeActivations = $derived(activations.filter((activation) => activation.state === "activated"));
  const selectedActivation = $derived(activeActivations.find((activation) => activation.instanceId === selectedInstanceId) ?? null);

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await trellis.request("Auth.ListDeviceActivations", { state: "activated" }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      const loadedActivations = response.activations ?? [];
      const loadedActiveActivations = loadedActivations.filter((activation) => activation.state === "activated");
      activations = loadedActivations;
      if (selectedInstanceId && !loadedActiveActivations.some((activation) => activation.instanceId === selectedInstanceId)) {
        selectedInstanceId = "";
      }
      if (!selectedInstanceId && loadedActiveActivations.length) {
        selectedInstanceId = loadedActiveActivations[0]?.instanceId ?? "";
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function revokeActivation() {
    if (!selectedActivation) return;
    pending = true;
    error = null;
    try {
      const response = await trellis.request(
        "Auth.RevokeDeviceActivation",
        { instanceId: selectedActivation.instanceId } satisfies AuthRevokeDeviceActivationInput,
      ).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Device activation revoked for ${selectedActivation.instanceId}.`, "Revoked");
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
  <PageToolbar title="Revoke device activation" description="Select an activated device instance and confirm revocation.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/devices/activations")}>Back to activations</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading active device activations" /></Panel>
  {:else if activeActivations.length === 0}
    <EmptyState title="No active activations" description="There are no activated device instances available to revoke." />
  {:else}
    <Panel title="Confirm activation revoke" eyebrow="Destructive workflow">
      <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); void revokeActivation(); }}>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Activated instance</span>
          <select class="select select-bordered select-sm" bind:value={selectedInstanceId} required>
            {#each activeActivations as activation (`${activation.instanceId}:${activation.activatedAt}`)}
              <option value={activation.instanceId}>{activation.instanceId} · {activation.deploymentId}</option>
            {/each}
          </select>
        </label>

        {#if selectedActivation}
          <div class="rounded-box border border-base-300 bg-base-200/40 p-3 text-sm">
            <div class="trellis-identifier font-medium">{selectedActivation.instanceId}</div>
            <div class="text-base-content/60">Deployment: {selectedActivation.deploymentId}</div>
            <div class="text-base-content/60">Activated: {formatDate(selectedActivation.activatedAt)}</div>
            <div class="text-base-content/60">Activated by: {selectedActivation.activatedBy ? `${selectedActivation.activatedBy.origin}:${selectedActivation.activatedBy.id}` : "—"}</div>
          </div>
        {/if}

        <div class="flex justify-end">
          <button type="submit" class="btn btn-error btn-sm" disabled={pending || !selectedActivation}>
            {pending ? "Revoking…" : "Revoke activation"}
          </button>
        </div>
      </form>
    </Panel>
  {/if}
</section>
