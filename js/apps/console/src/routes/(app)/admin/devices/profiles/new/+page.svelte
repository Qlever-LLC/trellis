<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type { AuthCreateDeviceDeploymentInput } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "$lib/format";
  import { getNotifications } from "$lib/notifications.svelte";
  import { getTrellis } from "$lib/trellis";

  const trellis = getTrellis();
  const notifications = getNotifications();

  let error = $state<string | null>(null);
  let pending = $state(false);
  let deploymentId = $state("");
  let reviewMode = $state<"none" | "required">("none");

  async function createDeployment() {
    pending = true;
    error = null;
    try {
      const input: AuthCreateDeviceDeploymentInput = {
        deploymentId: deploymentId.trim(),
        reviewMode,
      };

      const response = await trellis.request("Auth.CreateDeviceDeployment", input).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Device deployment ${input.deploymentId} created.`, "Created");
      deploymentId = "";
      reviewMode = "none";
    } catch (e) {
      error = errorMessage(e);
    } finally {
      pending = false;
    }
  }
</script>

<section class="space-y-4">
  <PageToolbar title="Create device deployment" description="Create a deployment that controls device activation review requirements.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/devices/profiles")}>Back to deployments</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  <Panel title="Deployment details" eyebrow="Device authorization">
    <form class="grid gap-3 lg:grid-cols-2" onsubmit={(event) => { event.preventDefault(); void createDeployment(); }}>
      <label class="form-control gap-1">
        <span class="label-text text-xs">Deployment ID</span>
        <input class="input input-bordered input-sm" bind:value={deploymentId} placeholder="reader.default" required />
      </label>

      <label class="form-control gap-1">
        <span class="label-text text-xs">Review mode</span>
        <select class="select select-bordered select-sm" bind:value={reviewMode}>
          <option value="none">No review</option>
          <option value="required">Review required</option>
        </select>
      </label>

      <div class="flex items-end justify-end lg:col-span-2">
        <button type="submit" class="btn btn-outline btn-sm" disabled={pending || !deploymentId.trim()}>
          {pending ? "Creating…" : "Create deployment"}
        </button>
      </div>
    </form>
  </Panel>
</section>
