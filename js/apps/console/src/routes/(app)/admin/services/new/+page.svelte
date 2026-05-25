<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import { resolve } from "$app/paths";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "$lib/format";
  import { getNotifications } from "$lib/notifications.svelte";
  import { getTrellis } from "$lib/trellis";

  const trellis = getTrellis();
  const notifications = getNotifications();

  type ContractCompatibilityMode = "strict" | "mutable-dev";

  let error = $state<string | null>(null);
  let createPending = $state(false);
  let deploymentId = $state("");
  let namespaces = $state("");
  let contractCompatibilityMode = $state<ContractCompatibilityMode>("strict");

  function parseNamespaces(value: string): string[] {
    return value.split(/[,\n]/).map((part) => part.trim()).filter(Boolean);
  }

  async function createDeployment() {
    createPending = true;
    error = null;
    try {
      const nextDeploymentId = deploymentId.trim();
      const response = await trellis.request("Auth.Deployments.Create", {
        deploymentId: nextDeploymentId,
        kind: "service",
        namespaces: parseNamespaces(namespaces),
        contractCompatibilityMode,
      }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Service deployment ${nextDeploymentId} created.`, "Created");
      deploymentId = "";
      namespaces = "";
      contractCompatibilityMode = "strict";
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
    <Notice variant="error">{error}</Notice>
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

      <fieldset class="grid gap-2">
        <legend class="label-text text-xs">Compatibility mode</legend>
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="flex cursor-pointer gap-3 rounded-box border border-base-300 bg-base-100 px-3 py-2">
            <input type="radio" class="radio radio-sm mt-0.5" bind:group={contractCompatibilityMode} value="strict" />
            <span class="min-w-0">
              <span class="block text-sm font-medium">Strict</span>
              <span class="block text-xs leading-4 text-base-content/60">Production default. Rejects incompatible same-contract digest replacements.</span>
            </span>
          </label>
          <label class="flex cursor-pointer gap-3 rounded-box border border-base-300 bg-base-100 px-3 py-2">
            <input type="radio" class="radio radio-sm mt-0.5" bind:group={contractCompatibilityMode} value="mutable-dev" />
            <span class="min-w-0">
              <span class="block text-sm font-medium">Mutable dev</span>
              <span class="block text-xs leading-4 text-base-content/60">Development only. Permits incompatible same-contract replacement when the envelope fits.</span>
            </span>
          </label>
        </div>
      </fieldset>

      <div class="flex flex-wrap justify-end gap-2">
        <a href={resolve("/admin/services")} class="btn btn-ghost btn-sm">Cancel</a>
        <button type="submit" class="btn btn-outline btn-sm" disabled={createPending || !deploymentId.trim() || parseNamespaces(namespaces).length === 0}>
          {createPending ? "Creating…" : "Create deployment"}
        </button>
      </div>
    </form>
  </Panel>
</section>
