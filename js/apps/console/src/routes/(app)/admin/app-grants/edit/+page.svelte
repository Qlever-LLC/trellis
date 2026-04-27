<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthListInstalledContractsOutput,
    AuthListInstanceGrantPoliciesOutput,
    AuthUpsertInstanceGrantPolicyInput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  type PolicyRecord = AuthListInstanceGrantPoliciesOutput["policies"][number];
  type ContractRecord = AuthListInstalledContractsOutput["contracts"][number];
  type ContractLineage = { id: string; displayName: string; digests: string[] };

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let savePending = $state(false);
  let policies = $state<PolicyRecord[]>([]);
  let contracts = $state<ContractRecord[]>([]);
  let selectedContractId = $state("");
  let impliedCapabilitiesText = $state("");
  let allowedOriginsText = $state("");

  const lineages = $derived.by(() => {
    const byId: Record<string, ContractLineage> = {};
    for (const contract of contracts) {
      const existing = byId[contract.id];
      if (existing) {
        if (!existing.digests.includes(contract.digest)) existing.digests = [...existing.digests, contract.digest];
        if (!existing.displayName && contract.displayName) existing.displayName = contract.displayName;
      } else {
        byId[contract.id] = { id: contract.id, displayName: contract.displayName || contract.id, digests: [contract.digest] };
      }
    }
    return Object.values(byId).sort((left, right) => (left.displayName || left.id).localeCompare(right.displayName || right.id));
  });
  const lineageById = $derived(Object.fromEntries(lineages.map((lineage) => [lineage.id, lineage])) as Record<string, ContractLineage>);
  const policyByContractId = $derived(Object.fromEntries(policies.map((policy) => [policy.contractId, policy])) as Record<string, PolicyRecord>);
  const selectedPolicy = $derived(selectedContractId ? (policyByContractId[selectedContractId] ?? null) : null);
  const saveLabel = $derived(selectedPolicy?.disabled ? "Save & Activate" : selectedPolicy ? "Save Changes" : "Create Policy");

  function parseCsv(value: string): string[] {
    const values: string[] = [];
    for (const entry of value.split(",").map((part) => part.trim()).filter(Boolean)) {
      if (!values.includes(entry)) values.push(entry);
    }
    return values;
  }

  function loadPolicyIntoForm(contractId: string) {
    selectedContractId = contractId;
    const policy = policyByContractId[contractId];
    impliedCapabilitiesText = policy?.impliedCapabilities.join(", ") ?? "";
    allowedOriginsText = policy?.allowedOrigins?.join(", ") ?? "";
  }

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
      policies = (policyRes.policies ?? []).slice().sort((left, right) => left.contractId.localeCompare(right.contractId));
      contracts = contractRes.contracts ?? [];
      const contract = page.url.searchParams.get("contract");
      if (contract) loadPolicyIntoForm(contract);
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
      const response = await trellis.request("Auth.UpsertInstanceGrantPolicy", {
        contractId,
        impliedCapabilities: parseCsv(impliedCapabilitiesText),
        allowedOrigins: allowedOrigins.length ? allowedOrigins : undefined,
      } satisfies AuthUpsertInstanceGrantPolicyInput).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Instance grant policy saved for ${contractId}.`, "Saved");
      await load();
      loadPolicyIntoForm(contractId);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      savePending = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Edit app grant policy" description="Create or update an instance grant policy.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/app-grants")}>Back to app grants</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading policy workflow" /></Panel>
  {:else}
    <Panel title="Instance grant policy" eyebrow="Workflow">
      <form class="grid gap-3 md:grid-cols-2" onsubmit={(event) => { event.preventDefault(); void savePolicy(); }}>
        <label class="form-control gap-1 md:col-span-2">
          <span class="label-text text-xs">Contract lineage</span>
          <select class="select select-bordered select-sm" bind:value={selectedContractId} onchange={() => loadPolicyIntoForm(selectedContractId)} required>
            <option value="">Select a contract lineage</option>
            {#each lineages as lineage (lineage.id)}
              <option value={lineage.id}>{lineage.displayName} ({lineage.id})</option>
            {/each}
          </select>
          {#if selectedContractId && lineageById[selectedContractId]}
            <span class="label-text-alt text-base-content/50">{lineageById[selectedContractId].digests.length} installed digest{lineageById[selectedContractId].digests.length !== 1 ? "s" : ""}</span>
          {/if}
        </label>

        <label class="form-control gap-1 md:col-span-2">
          <span class="label-text text-xs">Implied capabilities</span>
          <textarea class="textarea textarea-bordered textarea-sm min-h-24 font-mono" bind:value={impliedCapabilitiesText} placeholder="contracts.read, approvals.manage"></textarea>
          <span class="label-text-alt text-base-content/50">Comma-separated capability names.</span>
        </label>

        <label class="form-control gap-1 md:col-span-2">
          <span class="label-text text-xs">Allowed origins</span>
          <textarea class="textarea textarea-bordered textarea-sm min-h-24 font-mono" bind:value={allowedOriginsText} placeholder="https://console.example.com, https://portal.example.com"></textarea>
          <span class="label-text-alt text-base-content/50">Optional comma-separated origins. Leave blank to allow any origin.</span>
        </label>

        <div class="md:col-span-2 flex flex-wrap items-center gap-2">
          <button type="submit" class="btn btn-outline btn-sm" disabled={savePending || !selectedContractId.trim()}>{savePending ? "Saving..." : saveLabel}</button>
          <a class="btn btn-ghost btn-sm" href={resolve("/admin/app-grants")}>Cancel</a>
          {#if selectedPolicy}
            <span class={["badge badge-sm", selectedPolicy.disabled ? "badge-neutral" : "badge-success"]}>{selectedPolicy.disabled ? "Disabled policy loaded" : "Active policy loaded"}</span>
          {/if}
        </div>
      </form>
    </Panel>
  {/if}
</section>
