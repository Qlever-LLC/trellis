<script lang="ts">
  import { ulid } from "ulid";
  import { isErr } from "@qlever-llc/result";
  import type { AuthDeploymentsCreateInput } from "@trellis/apis/trellis.auth";
  import { resolve } from "$lib/console_paths";
  import Notice from "$lib/components/Notice.svelte";
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
  let requiresDeviceDelegation = $state(false);

  async function createDeployment() {
    pending = true;
    error = null;
    try {
      const input: AuthDeploymentsCreateInput = {
        displayName: deploymentId.trim(),
        expiresAt: null,
        idempotencyKey: ulid(),
        kind: "device",
        participantId: null,
        portalId: null,
        requiresDeviceDelegation,
        reviewMode,
      };

      const response = await trellis.authDeploymentsCreate(input).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Device deployment ${response.deployment.deploymentId} created.`, "Created");
      deploymentId = "";
      reviewMode = "none";
      requiresDeviceDelegation = false;
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
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/devices")}>Back to devices</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <Notice variant="error">{error}</Notice>
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

      <label class="form-control gap-1 lg:col-span-2">
        <span class="label cursor-pointer justify-start gap-3 rounded-box border border-base-300 px-3 py-2">
          <input class="checkbox checkbox-sm" type="checkbox" bind:checked={requiresDeviceDelegation} />
          <span>
            <span class="label-text text-sm">Require user delegation</span>
            <span class="block text-xs text-base-content/60">Require an activating user to grant device authority. Administrative review remains controlled separately above.</span>
          </span>
        </span>
      </label>

      <div class="flex items-end justify-end lg:col-span-2">
        <button type="submit" class="btn btn-outline btn-sm" disabled={pending || !deploymentId.trim()}>
          {pending ? "Creating…" : "Create deployment"}
        </button>
      </div>
    </form>
  </Panel>
</section>
