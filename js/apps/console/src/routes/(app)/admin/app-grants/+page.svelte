<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthListInstalledContractsOutput,
    AuthListInstanceGrantPoliciesOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import InlineMetricsStrip from "$lib/components/InlineMetricsStrip.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { getTrellis } from "../../../../lib/trellis";

  type PolicyRecord = AuthListInstanceGrantPoliciesOutput["policies"][number];
  type ContractRecord = AuthListInstalledContractsOutput["contracts"][number];
  type ContractLineage = {
    id: string;
    displayName: string;
    digests: string[];
  };

  const trellis = getTrellis();

  let loading = $state(true);
  let error = $state<string | null>(null);

  let policies = $state<PolicyRecord[]>([]);
  let contracts = $state<ContractRecord[]>([]);

  const lineages = $derived.by(() => {
    const byId: Record<string, ContractLineage> = {};

    for (const contract of contracts) {
      const existing = byId[contract.id];
      if (existing) {
        if (!existing.digests.includes(contract.digest)) {
          existing.digests = [...existing.digests, contract.digest];
        }
        if (!existing.displayName && contract.displayName) {
          existing.displayName = contract.displayName;
        }
        continue;
      }

      byId[contract.id] = {
        id: contract.id,
        displayName: contract.displayName || contract.id,
        digests: [contract.digest],
      };
    }

    return Object.values(byId).sort((left, right) =>
      (left.displayName || left.id).localeCompare(right.displayName || right.id)
    );
  });

  const lineageById = $derived(
    Object.fromEntries(lineages.map((lineage) => [lineage.id, lineage])) as Record<string, ContractLineage>,
  );
  const activePolicyCount = $derived(
    policies.filter((policy) => !policy.disabled).length,
  );

  async function load() {
    loading = true;
    error = null;
    try {
      const [policyRes, contractRes] = await Promise.all([
        trellis.request("Auth.ListInstanceGrantPolicies", {}).take(),
        trellis.request("Auth.ListInstalledContracts", {}).take(),
      ]);
      if (isErr(policyRes)) { error = errorMessage(policyRes); return; }
      if (isErr(contractRes)) { error = errorMessage(contractRes); return; }
      policies = (policyRes.policies ?? []).slice().sort((left, right) =>
        left.contractId.localeCompare(right.contractId)
      );
      contracts = contractRes.contracts ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="App grants" description="Configure instance grant policies for approved app instances.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
      <details class="dropdown dropdown-end">
        <summary class="btn btn-outline btn-sm">Actions <Icon name="chevronDown" size={14} /></summary>
        <ul class="menu dropdown-content z-10 mt-2 w-64 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
          <li><a href={resolve("/admin/app-grants/edit")}>Create or edit policy</a></li>
          <li><a href={resolve("/admin/app-grants/disable")}>Disable a policy</a></li>
        </ul>
      </details>
    {/snippet}
  </PageToolbar>

  <InlineMetricsStrip metrics={[{ label: "Active policies", value: activePolicyCount }]} />

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading app grant policies" /></Panel>
  {:else if policies.length === 0}
    <EmptyState title="No instance grant policies" description="Use Actions to open the policy workflow." />
  {:else}
    <Panel title="Policies" eyebrow="Primary table">
    <div class="overflow-x-auto">
      <table class="table table-sm trellis-table">
        <thead>
          <tr>
            <th>Contract lineage</th>
            <th>Implied capabilities</th>
            <th>Allowed origins</th>
            <th>Updated</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each policies as policy (policy.contractId)}
            <tr>
               <td>
                <div class="font-medium">{lineageById[policy.contractId]?.displayName ?? policy.contractId}</div>
                <div class="font-mono text-xs text-base-content/60">{policy.contractId}</div>
              </td>
              <td>
                <div class="flex flex-wrap gap-1">
                  {#each policy.impliedCapabilities as capability (capability)}
                    <span class="badge badge-outline badge-xs">{capability}</span>
                  {/each}
                  {#if policy.impliedCapabilities.length === 0}
                    <span class="text-xs text-base-content/40">None</span>
                  {/if}
                </div>
              </td>
              <td class="text-xs text-base-content/60">
                {#if policy.allowedOrigins?.length}
                  <div class="flex flex-col gap-1">
                    {#each policy.allowedOrigins as origin (origin)}
                      <span class="font-mono">{origin}</span>
                    {/each}
                  </div>
                {:else}
                  Any origin
                {/if}
              </td>
              <td class="text-base-content/60">{formatDate(policy.updatedAt)}</td>
              <td>
                <span class={[
                  "badge badge-sm",
                    policy.disabled ? "badge-neutral" : "badge-success",
                ]}>
                  {policy.disabled ? "Disabled" : "Active"}
                </span>
              </td>
              <td class="text-right">
                <details class="dropdown dropdown-end">
                  <summary class="btn btn-ghost btn-xs">Actions</summary>
                  <ul class="menu dropdown-content z-10 mt-2 w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
                    <li><a href={resolve(`/admin/app-grants/edit?contract=${encodeURIComponent(policy.contractId)}`)}>Edit</a></li>
                    <li><a class={policy.disabled ? "disabled" : "text-error"} href={resolve(`/admin/app-grants/disable?contract=${encodeURIComponent(policy.contractId)}`)}>Disable</a></li>
                  </ul>
                </details>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-base-content/50">{policies.length} polic{policies.length === 1 ? "y" : "ies"}</p>
    </Panel>
  {/if}
</section>
