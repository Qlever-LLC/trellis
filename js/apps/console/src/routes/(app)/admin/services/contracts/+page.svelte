<script lang="ts">
  import { isErr, type BaseError, type Result } from "@qlever-llc/result";
  import {
    CONTRACT as TRELLIS_AUTH_CONTRACT,
    CONTRACT_DIGEST as TRELLIS_AUTH_DIGEST,
  } from "@qlever-llc/trellis/sdk/auth";
  import type { TrellisCatalogOutput } from "@qlever-llc/trellis/sdk/core";
  import {
    CONTRACT as TRELLIS_CORE_CONTRACT,
    CONTRACT_DIGEST as TRELLIS_CORE_DIGEST,
  } from "@qlever-llc/trellis/sdk/core";
  import {
    CONTRACT as TRELLIS_HEALTH_CONTRACT,
    CONTRACT_DIGEST as TRELLIS_HEALTH_DIGEST,
  } from "@qlever-llc/trellis/sdk/health";
  import {
    CONTRACT as TRELLIS_JOBS_CONTRACT,
    CONTRACT_DIGEST as TRELLIS_JOBS_DIGEST,
  } from "@qlever-llc/trellis/sdk/jobs";
  import {
    CONTRACT as TRELLIS_STATE_CONTRACT,
    CONTRACT_DIGEST as TRELLIS_STATE_DIGEST,
  } from "@qlever-llc/trellis/sdk/state";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "../../../../../lib/format";
  import { getTrellis } from "../../../../../lib/trellis";

  type CatalogContract = TrellisCatalogOutput["catalog"]["contracts"][number];
  type ContractDetail = typeof TRELLIS_CORE_CONTRACT;
  type ContractEntry = {
    digest: string;
    id: string;
    displayName: string;
    description: string;
    kind: string;
    contract: ContractDetail | null;
  };
  type RpcTakeable<T> = { take(): Promise<T | Result<never, BaseError>> };
  type CoreRequest = {
    (method: "Trellis.Catalog", input: Record<string, never>): RpcTakeable<TrellisCatalogOutput>;
    (method: "Trellis.Contract.Get", input: { digest: string }): RpcTakeable<{ contract: ContractDetail }>;
  };

  const trellisPlatformContracts: ContractEntry[] = [
    contractEntry(TRELLIS_AUTH_DIGEST, TRELLIS_AUTH_CONTRACT),
    contractEntry(TRELLIS_CORE_DIGEST, TRELLIS_CORE_CONTRACT),
    contractEntry(TRELLIS_HEALTH_DIGEST, TRELLIS_HEALTH_CONTRACT),
    contractEntry(TRELLIS_STATE_DIGEST, TRELLIS_STATE_CONTRACT),
    contractEntry(TRELLIS_JOBS_DIGEST, TRELLIS_JOBS_CONTRACT),
  ];

  const trellis = getTrellis();
  const coreRequest = trellis.request.bind(trellis) as CoreRequest;

  let loading = $state(true);
  let error = $state<string | null>(null);
  let contracts = $state.raw<ContractEntry[]>(trellisPlatformContracts);
  let search = $state("");

  const filteredContracts = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return contracts;
    return contracts.filter((contract) =>
      contract.id.toLowerCase().includes(term) || contract.displayName.toLowerCase().includes(term) || contract.digest.toLowerCase().includes(term)
    );
  });

  function contractEntry(digest: string, contract: ContractDetail): ContractEntry {
    return {
      digest,
      id: contract.id,
      displayName: contract.displayName,
      description: contract.description,
      kind: contract.kind,
      contract,
    };
  }

  function contractHref(digest: string): string {
    return `/admin/services/contracts/${encodeURIComponent(digest)}`;
  }

  function objectRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  function catalogContractEntry(contract: CatalogContract): ContractEntry {
    return {
      digest: contract.digest,
      id: contract.id,
      displayName: contract.displayName,
      description: contract.description,
      kind: "contract",
      contract: null,
    };
  }

  function mergeContractEntries(entries: readonly ContractEntry[]): ContractEntry[] {
    return [...new Map(entries.map((entry) => [entry.digest, entry])).values()]
      .toSorted((left, right) => left.id.localeCompare(right.id) || left.digest.localeCompare(right.digest));
  }

  async function hydrateCatalogEntry(entry: ContractEntry): Promise<ContractEntry> {
    if (entry.contract) return entry;
    const response = await coreRequest("Trellis.Contract.Get", { digest: entry.digest }).take();
    if (isErr(response)) return entry;
    return contractEntry(entry.digest, response.contract);
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await coreRequest("Trellis.Catalog", {}).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      const catalogEntries = (response.catalog.contracts ?? []).map(catalogContractEntry);
      contracts = await Promise.all(mergeContractEntries([
        ...trellisPlatformContracts,
        ...catalogEntries,
      ]).map(hydrateCatalogEntry));
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Contract documentation" description="Active Trellis contract manifests and full documentation, including platform contracts without service deployments.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/services")}>Back to services</a>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}<Notice variant="error">{error}</Notice>{/if}

  {#if loading}
    <Panel><LoadingState label="Loading contract catalog" /></Panel>
  {:else}
    <Panel>
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold uppercase tracking-wide text-base-content/70">Contracts</h2>
          <p class="text-xs text-base-content/50">{contracts.length} active contract{contracts.length === 1 ? "" : "s"}</p>
        </div>
        <label class="input input-bordered input-sm flex items-center gap-2">
          <span class="text-xs text-base-content/50">Search</span>
          <input bind:value={search} class="grow" placeholder="Contract ID or digest" aria-label="Search contracts" />
        </label>
      </div>

      <DataTable>
        <thead><tr><th>Contract</th><th>Kind</th><th>Digest</th><th>Docs</th></tr></thead>
        <tbody>
          {#each filteredContracts as contract (contract.digest)}
            <tr>
              <td><div class="trellis-identifier font-medium">{contract.id}</div><div class="text-xs text-base-content/50">{contract.displayName}</div></td>
              <td>{contract.kind}</td>
              <td class="trellis-identifier text-base-content/60">{contract.digest}</td>
              <td><a class="btn btn-ghost btn-xs" href={contractHref(contract.digest)}>Open full docs</a></td>
            </tr>
          {:else}
            <tr><td colspan="4" class="text-base-content/50">No matching contracts.</td></tr>
          {/each}
        </tbody>
      </DataTable>
    </Panel>

  {/if}
</section>
