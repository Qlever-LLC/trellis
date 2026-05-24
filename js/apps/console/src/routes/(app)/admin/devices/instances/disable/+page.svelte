<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthDevicesDisableInput,
    AuthDevicesListOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import ConfirmationModal from "$lib/components/ConfirmationModal.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getNotifications } from "$lib/notifications.svelte";
  import { getTrellis } from "$lib/trellis";

  type Instance = AuthDevicesListOutput["entries"][number];

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let pending = $state(false);
  let instances = $state<Instance[]>([]);
  let selectedInstanceId = $state(page.url.searchParams.get("instance") ?? "");
  let confirmationModal: ConfirmationModal | undefined = $state();

  const disableableInstances = $derived(instances.filter((instance) => instance.state !== "disabled"));
  const selectedInstance = $derived(disableableInstances.find((instance) => instance.instanceId === selectedInstanceId) ?? null);

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await trellis.request("Auth.Devices.List", { limit: 500, offset: 0 }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      const loadedInstances = response.entries ?? [];
      const loadedDisableableInstances = loadedInstances.filter((instance) => instance.state !== "disabled");
      instances = loadedInstances;
      if (selectedInstanceId && !loadedDisableableInstances.some((instance) => instance.instanceId === selectedInstanceId)) {
        selectedInstanceId = "";
      }
      if (!selectedInstanceId && loadedDisableableInstances.length) {
        selectedInstanceId = loadedDisableableInstances[0]?.instanceId ?? "";
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function disableInstance() {
    if (!selectedInstance) return;
    pending = true;
    error = null;
    try {
      const response = await trellis.request(
        "Auth.Devices.Disable",
        { instanceId: selectedInstance.instanceId } satisfies AuthDevicesDisableInput,
      ).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Device instance ${selectedInstance.instanceId} disabled.`, "Disabled");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      pending = false;
    }
  }

  async function requestDisableInstance() {
    if (!selectedInstance) return;
    const confirmed = await confirmationModal?.confirm({
      title: "Disable device instance?",
      message: "This prevents the device instance from authenticating until it is explicitly re-enabled.",
      confirmLabel: "Disable instance",
      targetLabel: "Device instance",
      targetName: selectedInstance.instanceId,
      expectedValue: selectedInstance.instanceId,
    });
    if (confirmed) await disableInstance();
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Disable device instance" description="Select a device instance and confirm the disable workflow.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href="/admin/devices">Back to devices</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <Notice variant="error">{error}</Notice>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading device instances" /></Panel>
  {:else if disableableInstances.length === 0}
    <EmptyState title="No instances available" description="There are no non-disabled device instances available to disable." />
  {:else}
    <Panel title="Confirm instance disable" eyebrow="Destructive workflow">
      <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); void requestDisableInstance(); }}>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Instance</span>
          <select class="select select-bordered select-sm" bind:value={selectedInstanceId} required>
            {#each disableableInstances as instance (`${instance.instanceId}:${instance.createdAt}`)}
              <option value={instance.instanceId}>{instance.instanceId} · {instance.deploymentId} · {instance.state}</option>
            {/each}
          </select>
        </label>

        {#if selectedInstance}
          <div class="rounded-box border border-base-300 bg-base-200/40 p-3 text-sm">
            <div class="trellis-identifier font-medium">{selectedInstance.instanceId}</div>
            <div class="text-base-content/60">Deployment: {selectedInstance.deploymentId}</div>
            <div class="text-base-content/60">State: {selectedInstance.state}</div>
            <div class="text-base-content/60">Created: {formatDate(selectedInstance.createdAt)}</div>
          </div>
        {/if}

        <div class="flex justify-end">
          <button type="submit" class="btn btn-error btn-sm" disabled={pending || !selectedInstance}>
            {pending ? "Disabling…" : "Disable instance"}
          </button>
        </div>
      </form>
    </Panel>
  {/if}
</section>

<ConfirmationModal bind:this={confirmationModal} />
