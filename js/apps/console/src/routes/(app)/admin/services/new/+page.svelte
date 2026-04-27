<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import { resolve } from "$app/paths";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "$lib/format";
  import { getNotifications } from "$lib/notifications.svelte";
  import { getTrellis } from "$lib/trellis";

  const trellis = getTrellis();
  const notifications = getNotifications();

  let error = $state<string | null>(null);
  let createPending = $state(false);
  let deploymentId = $state("");
  let namespaces = $state("");

  function parseNamespaces(value: string): string[] {
    return value.split(/[,\n]/).map((part) => part.trim()).filter(Boolean);
  }

  async function createDeployment() {
    createPending = true;
    error = null;
    try {
      const nextDeploymentId = deploymentId.trim();
      const response = await trellis.request("Auth.CreateServiceDeployment", {
        deploymentId: nextDeploymentId,
        namespaces: parseNamespaces(namespaces),
      }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Service deployment ${nextDeploymentId} created.`, "Created");
      deploymentId = "";
      namespaces = "";
    } catch (e) {
      error = errorMessage(e);
    } finally {
      createPending = false;
    }
  }
</script>

<section class="space-y-4">
  <PageToolbar title="Create service deployment" description="Create a service deployment and namespace allow-list.">
    {#snippet actions()}
      <a href={resolve("/admin/services")} class="btn btn-ghost btn-sm">Back to service deployments</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  <Panel title="New deployment" eyebrow="Service authorization" class="max-w-3xl">
    <form class="grid gap-4" onsubmit={(event) => { event.preventDefault(); void createDeployment(); }}>
      <label class="form-control gap-1">
        <span class="label-text text-xs">Deployment ID</span>
        <input class="input input-bordered input-sm font-mono" bind:value={deploymentId} placeholder="billing.worker" required />
      </label>

      <label class="form-control gap-1">
        <span class="label-text text-xs">Namespaces</span>
        <textarea class="textarea textarea-bordered textarea-sm font-mono" rows="4" bind:value={namespaces} placeholder="billing, invoices" required></textarea>
        <span class="label-text-alt text-base-content/60">Separate namespaces with commas or new lines.</span>
      </label>

      <div class="flex flex-wrap justify-end gap-2">
        <a href={resolve("/admin/services")} class="btn btn-ghost btn-sm">Cancel</a>
        <button type="submit" class="btn btn-outline btn-sm" disabled={createPending || !deploymentId.trim() || parseNamespaces(namespaces).length === 0}>
          {createPending ? "Creating…" : "Create deployment"}
        </button>
      </div>
    </form>
  </Panel>
</section>
