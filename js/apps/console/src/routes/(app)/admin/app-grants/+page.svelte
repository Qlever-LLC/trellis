<script lang="ts">
  import type {
    AuthDisableInstanceGrantPolicyInput,
    AuthListInstalledContractsOutput,
    AuthListInstanceGrantPoliciesOutput,
    AuthUpsertInstanceGrantPolicyInput,
  } from "@qlever-llc/trellis-sdk/auth";
  import { onMount } from "svelte";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { getNotifications } from "../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../lib/trellis";

  type PolicyRecord = AuthListInstanceGrantPoliciesOutput["policies"][number];
  type ContractRecord = AuthListInstalledContractsOutput["contracts"][number];
  type ContractLineage = {
    id: string;
    displayName: string;
    digests: string[];
  };

  const trellisPromise = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let savePending = $state(false);
  let disableTarget = $state<string | null>(null);

  let policies = $state<PolicyRecord[]>([]);
  let contracts = $state<ContractRecord[]>([]);

  let selectedContractId = $state("");
  let impliedCapabilitiesText = $state("");
  let allowedOriginsText = $state("");
  let editingContractId = $state<string | null>(null);

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
  const policyByContractId = $derived(
    Object.fromEntries(policies.map((policy) => [policy.contractId, policy])) as Record<string, PolicyRecord>,
  );
  const activePolicyCount = $derived(
    policies.filter((policy) => !policy.disabled).length,
  );
  const selectedPolicy = $derived(
    selectedContractId ? (policyByContractId[selectedContractId] ?? null) : null,
  );
  const saveLabel = $derived(
    selectedPolicy?.disabled
      ? "Save & Activate"
      : selectedPolicy
      ? "Save Changes"
      : "Create Policy",
  );

  function parseCsv(value: string): string[] {
    const values: string[] = [];

    for (const entry of value.split(",").map((part) => part.trim()).filter(Boolean)) {
      if (values.includes(entry)) continue;
      values.push(entry);
    }

    return values;
  }

  function resetForm() {
    editingContractId = null;
    selectedContractId = "";
    impliedCapabilitiesText = "";
    allowedOriginsText = "";
  }

  function loadPolicyIntoForm(policy: PolicyRecord) {
    editingContractId = policy.contractId;
    selectedContractId = policy.contractId;
    impliedCapabilitiesText = policy.impliedCapabilities.join(", ");
    allowedOriginsText = policy.allowedOrigins?.join(", ") ?? "";
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const trellis = await trellisPromise;
      const [policyRes, contractRes] = await Promise.all([
        trellis.requestOrThrow("Auth.ListInstanceGrantPolicies", {}),
        trellis.requestOrThrow("Auth.ListInstalledContracts", {}),
      ]);
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

  async function savePolicy() {
    const contractId = selectedContractId.trim();
    if (!contractId) return;

    const allowedOrigins = parseCsv(allowedOriginsText);

    savePending = true;
    error = null;
    try {
      const trellis = await trellisPromise;
      await trellis.requestOrThrow("Auth.UpsertInstanceGrantPolicy", {
        contractId,
        impliedCapabilities: parseCsv(impliedCapabilitiesText),
        allowedOrigins: allowedOrigins.length ? allowedOrigins : undefined,
      } satisfies AuthUpsertInstanceGrantPolicyInput);
      notifications.success(`Instance grant policy saved for ${contractId}.`, "Saved");
      editingContractId = contractId;
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      savePending = false;
    }
  }

  async function disablePolicy(policy: PolicyRecord) {
    if (policy.disabled) return;
    if (!window.confirm(`Disable the instance grant policy for ${policy.contractId}?`)) return;

    disableTarget = policy.contractId;
    error = null;
    try {
      const trellis = await trellisPromise;
      await trellis.requestOrThrow("Auth.DisableInstanceGrantPolicy", {
        contractId: policy.contractId,
      } satisfies AuthDisableInstanceGrantPolicyInput);
      notifications.success(`Instance grant policy disabled for ${policy.contractId}.`, "Disabled");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      disableTarget = null;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <div class="flex items-center justify-between gap-4">
    <div class="stats shadow border border-base-300">
      <div class="stat py-2 px-4">
        <div class="stat-title text-xs">Active policies</div>
        <div class="stat-value text-xl">{activePolicyCount}</div>
      </div>
    </div>

    <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
  </div>

  <div class="card border border-base-300 bg-base-100">
    <div class="card-body gap-4">
      <div class="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 class="card-title text-base">Instance grant policy</h2>
          <p class="text-sm text-base-content/60">Allow a contract lineage to imply capabilities for approved instances and optionally restrict allowed origins.</p>
        </div>

        {#if editingContractId}
          <button type="button" class="btn btn-ghost btn-xs" onclick={resetForm}>New policy</button>
        {/if}
      </div>

      <form class="grid gap-3 md:grid-cols-2" onsubmit={(event) => { event.preventDefault(); void savePolicy(); }}>
        <label class="form-control gap-1 md:col-span-2">
          <span class="label-text text-xs">Contract lineage</span>
          <select class="select select-bordered select-sm" bind:value={selectedContractId} required>
            <option value="">Select a contract lineage</option>
            {#each lineages as lineage (lineage.id)}
              <option value={lineage.id}>{lineage.displayName} ({lineage.id})</option>
            {/each}
          </select>
          {#if selectedContractId && lineageById[selectedContractId]}
            <span class="label-text-alt text-base-content/50">
              {lineageById[selectedContractId].digests.length} installed digest{lineageById[selectedContractId].digests.length !== 1 ? "s" : ""}
            </span>
          {/if}
        </label>

        <label class="form-control gap-1 md:col-span-2">
          <span class="label-text text-xs">Implied capabilities</span>
          <textarea
            class="textarea textarea-bordered textarea-sm min-h-24 font-mono"
            bind:value={impliedCapabilitiesText}
            placeholder="contracts.read, approvals.manage"
          ></textarea>
          <span class="label-text-alt text-base-content/50">Comma-separated capability names.</span>
        </label>

        <label class="form-control gap-1 md:col-span-2">
          <span class="label-text text-xs">Allowed origins</span>
          <textarea
            class="textarea textarea-bordered textarea-sm min-h-24 font-mono"
            bind:value={allowedOriginsText}
            placeholder="https://console.example.com, https://portal.example.com"
          ></textarea>
          <span class="label-text-alt text-base-content/50">Optional comma-separated origins. Leave blank to allow any origin.</span>
        </label>

        <div class="md:col-span-2 flex flex-wrap items-center gap-2">
          <button type="submit" class="btn btn-primary btn-sm" disabled={savePending || !selectedContractId.trim()}>
            {savePending ? "Saving..." : saveLabel}
          </button>

          <button type="button" class="btn btn-ghost btn-sm" onclick={resetForm} disabled={savePending}>Clear</button>

          {#if selectedPolicy}
            <span class={[
              "badge badge-sm",
              selectedPolicy.disabled ? "badge-ghost" : "badge-success",
            ]}>
              {selectedPolicy.disabled ? "Disabled policy loaded" : "Active policy loaded"}
            </span>
          {/if}
        </div>
      </form>
    </div>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
  {:else if policies.length === 0}
    <p class="text-sm text-base-content/60">No instance grant policies found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
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
                  policy.disabled ? "badge-ghost" : "badge-success",
                ]}>
                  {policy.disabled ? "Disabled" : "Active"}
                </span>
              </td>
              <td class="text-right">
                <div class="flex justify-end gap-2">
                  <button class="btn btn-ghost btn-xs" onclick={() => loadPolicyIntoForm(policy)}>
                    Edit
                  </button>
                  <button
                    class="btn btn-ghost btn-xs text-error"
                    onclick={() => disablePolicy(policy)}
                    disabled={policy.disabled || disableTarget === policy.contractId}
                  >
                    {disableTarget === policy.contractId ? "Disabling..." : "Disable"}
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-base-content/50">{policies.length} polic{policies.length === 1 ? "y" : "ies"}</p>
  {/if}
</section>
