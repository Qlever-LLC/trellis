<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type { AuthDisableInstanceGrantPolicyInput, AuthListInstanceGrantPoliciesOutput } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  type PolicyRecord = AuthListInstanceGrantPoliciesOutput["policies"][number];

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let pending = $state(false);
  let selectedContractId = $state("");
  let policies = $state<PolicyRecord[]>([]);

  const activePolicies = $derived(policies.filter((policy) => !policy.disabled));
  const selectedPolicy = $derived(policies.find((policy) => policy.contractId === selectedContractId) ?? null);

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await trellis.request("Auth.ListInstanceGrantPolicies", {}).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      policies = (response.policies ?? []).slice().sort((left, right) => left.contractId.localeCompare(right.contractId));
      selectedContractId = page.url.searchParams.get("contract") ?? selectedContractId;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function disablePolicy() {
    if (!selectedPolicy || selectedPolicy.disabled) return;
    pending = true;
    error = null;
    try {
      const response = await trellis.request("Auth.DisableInstanceGrantPolicy", { contractId: selectedPolicy.contractId } satisfies AuthDisableInstanceGrantPolicyInput).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Instance grant policy disabled for ${selectedPolicy.contractId}.`, "Disabled");
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
  <PageToolbar title="Disable app grant policy" description="Confirm and disable an instance grant policy.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/app-grants")}>Back to app grants</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading policies" /></Panel>
  {:else if activePolicies.length === 0}
    <EmptyState title="No active policies" description="There are no active instance grant policies to disable." />
  {:else}
    <Panel title="Confirm disable" eyebrow="Workflow">
      <div class="space-y-4">
        <label class="form-control gap-1">
          <span class="label-text text-xs">Policy</span>
          <select class="select select-bordered select-sm" bind:value={selectedContractId} required>
            <option value="">Select a policy</option>
            {#each activePolicies as policy (policy.contractId)}
              <option value={policy.contractId}>{policy.contractId}</option>
            {/each}
          </select>
        </label>

        {#if selectedPolicy}
          <div class="rounded-box border border-base-300 p-3 text-sm">
            <div class="font-medium">{selectedPolicy.contractId}</div>
            <div class="mt-2 flex flex-wrap gap-1">
              {#each selectedPolicy.impliedCapabilities as capability (capability)}
                <span class="badge badge-outline badge-xs">{capability}</span>
              {:else}
                <span class="text-xs text-base-content/50">No implied capabilities</span>
              {/each}
            </div>
          </div>
        {/if}

        <div class="flex flex-wrap gap-2">
          <button class="btn btn-error btn-sm" onclick={disablePolicy} disabled={!selectedPolicy || selectedPolicy.disabled || pending}>{pending ? "Disabling..." : "Disable policy"}</button>
          <a class="btn btn-ghost btn-sm" href={resolve("/admin/app-grants")}>Cancel</a>
        </div>
      </div>
    </Panel>
  {/if}
</section>
