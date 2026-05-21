<script lang="ts">
  import { isErr, type AsyncResult, type BaseError } from "@qlever-llc/result";
  import type { DeploymentGrantOverride } from "@qlever-llc/trellis/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import ConfirmationModal from "$lib/components/ConfirmationModal.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type GrantIdentityKind = "web" | "session";
  type ListPageInput = {
    offset?: number;
    limit: number;
  };
  type GrantOverrideListOutput = {
    entries: DeploymentGrantOverride[];
    nextOffset?: number;
  };
  type GrantOverrideMutationOutput = {
    grantOverrides: DeploymentGrantOverride[];
  };
  type GrantOverrideMutationInput = {
    deploymentId: string;
    overrides: DeploymentGrantOverride[];
  };
  type AuthRpcClient = {
    request(subject: "Auth.Envelopes.GrantOverrides.List", input: ListPageInput): AsyncResult<GrantOverrideListOutput, BaseError>;
    request(subject: "Auth.Envelopes.GrantOverrides.Remove", input: GrantOverrideMutationInput): AsyncResult<GrantOverrideMutationOutput, BaseError>;
  };
  type GrantOverrideRow = DeploymentGrantOverride;
  type GrantOverrideGroup = {
    key: string;
    identityKind: GrantIdentityKind;
    contractId: string;
    origin: string | null;
    sessionPublicKey: string | null;
    directCapabilities: string[];
    capabilityGroupKeys: string[];
    rows: GrantOverrideRow[];
  };

  const trellis = getTrellis();
  const authRpc = trellis as AuthRpcClient;

  let loading = $state(true);
  let removingKey = $state<string | null>(null);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let search = $state("");
  let rows = $state.raw<GrantOverrideRow[]>([]);
  let confirmationModal: ConfirmationModal | undefined = $state();

  const busy = $derived(loading || removingKey !== null);
  const filteredRows = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => searchableGrantText(row).includes(term));
  });
  const filteredGrantGroups = $derived(groupGrantOverrides(filteredRows));
  function uniqueGrantReferences(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
  }

  function grantOverrideKey(override: DeploymentGrantOverride): string {
    return [
      override.deploymentId,
      override.identityKind,
      override.grantKind,
      override.contractId,
      override.origin ?? "-",
      override.sessionPublicKey ?? "-",
      grantOverrideReference(override),
    ].join("|");
  }

  function grantTargetKey(override: DeploymentGrantOverride): string {
    return [
      override.identityKind,
      override.contractId,
      override.origin ?? "-",
      override.sessionPublicKey ?? "-",
    ].join("|");
  }

  function grantOverrideReference(override: DeploymentGrantOverride): string {
    return override.grantKind === "capability" ? override.capability : override.capabilityGroupKey;
  }

  function groupGrantOverrides(overrides: GrantOverrideRow[]): GrantOverrideGroup[] {
    const groups: Record<string, GrantOverrideGroup> = {};
    for (const override of overrides) {
      const key = grantTargetKey(override);
      const existing = groups[key];
      if (existing) {
        existing.rows.push(override);
        if (override.grantKind === "capability") {
          existing.directCapabilities = uniqueGrantReferences([...existing.directCapabilities, override.capability]);
        } else {
          existing.capabilityGroupKeys = uniqueGrantReferences([...existing.capabilityGroupKeys, override.capabilityGroupKey]);
        }
      } else {
        groups[key] = {
          key,
          identityKind: override.identityKind,
          contractId: override.contractId,
          origin: override.origin,
          sessionPublicKey: override.sessionPublicKey,
          directCapabilities: override.grantKind === "capability" ? [override.capability] : [],
          capabilityGroupKeys: override.grantKind === "capability-group" ? [override.capabilityGroupKey] : [],
          rows: [override],
        };
      }
    }
    return Object.values(groups).map((group) => ({
      ...group,
      directCapabilities: group.directCapabilities.slice().sort((left, right) => left.localeCompare(right)),
      capabilityGroupKeys: group.capabilityGroupKeys.slice().sort((left, right) => left.localeCompare(right)),
    })).sort((left, right) => left.key.localeCompare(right.key));
  }

  function rowToOverride(row: GrantOverrideRow): DeploymentGrantOverride {
    if (row.identityKind === "web") {
      if (row.grantKind === "capability") {
        return {
          deploymentId: row.deploymentId,
          identityKind: "web",
          grantKind: "capability",
          contractId: row.contractId,
          origin: row.origin,
          sessionPublicKey: null,
          capability: row.capability,
          capabilityGroupKey: null,
        };
      }
      return {
        deploymentId: row.deploymentId,
        identityKind: "web",
        grantKind: "capability-group",
        contractId: row.contractId,
        origin: row.origin,
        sessionPublicKey: null,
        capability: null,
        capabilityGroupKey: row.capabilityGroupKey,
      };
    }
    if (row.grantKind === "capability") {
      return {
        deploymentId: row.deploymentId,
        identityKind: "session",
        grantKind: "capability",
        contractId: row.contractId,
        origin: null,
        sessionPublicKey: row.sessionPublicKey,
        capability: row.capability,
        capabilityGroupKey: null,
      };
    }
    return {
      deploymentId: row.deploymentId,
      identityKind: "session",
      grantKind: "capability-group",
      contractId: row.contractId,
      origin: null,
      sessionPublicKey: row.sessionPublicKey,
      capability: null,
      capabilityGroupKey: row.capabilityGroupKey,
    };
  }

  function searchableGrantText(row: GrantOverrideRow): string {
    return [
      row.deploymentId,
      row.identityKind,
      row.contractId ?? "",
      row.origin ?? "",
      row.sessionPublicKey ?? "",
      row.grantKind,
      grantOverrideReference(row),
    ].join(" ").toLowerCase();
  }

  async function load(options: { preserveSaved?: boolean } = {}): Promise<void> {
    loading = true;
    error = null;
    if (!options.preserveSaved) saved = null;
    try {
      const grantOverrides = await loadAllGrantOverrides();
      rows = grantOverrides
        .sort((left, right) => grantOverrideKey(left).localeCompare(grantOverrideKey(right)));
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function loadAllGrantOverrides(): Promise<DeploymentGrantOverride[]> {
    const entries: DeploymentGrantOverride[] = [];
    let offset = 0;
    while (true) {
      const response = await authRpc.request("Auth.Envelopes.GrantOverrides.List", { limit: 500, offset }).take();
      if (isErr(response)) throw new Error(errorMessage(response));
      entries.push(...response.entries);
      if (response.nextOffset === undefined) return entries;
      offset = response.nextOffset;
    }
  }

  async function removeGrantOverrideGroup(group: GrantOverrideGroup): Promise<void> {
    const key = group.key;
    removingKey = key;
    error = null;
    saved = null;
    try {
      const byDeployment: Record<string, DeploymentGrantOverride[]> = {};
      for (const row of group.rows) {
        byDeployment[row.deploymentId] = [...(byDeployment[row.deploymentId] ?? []), rowToOverride(row)];
      }
      for (const [deploymentId, overrides] of Object.entries(byDeployment)) {
        const response = await authRpc.request("Auth.Envelopes.GrantOverrides.Remove", {
          deploymentId,
          overrides,
        }).take();
        if (isErr(response)) {
          error = errorMessage(response);
          return;
        }
      }
      saved = "Removed grant override.";
      await load({ preserveSaved: true });
    } catch (e) {
      error = errorMessage(e);
    } finally {
      removingKey = null;
    }
  }

  async function requestRemoveGrantOverrideGroup(group: GrantOverrideGroup): Promise<void> {
    const confirmed = await confirmationModal?.confirm({
      title: "Remove grant override?",
      message: `This removes ${group.rows.length} stored grant override${group.rows.length === 1 ? "" : "s"} for the selected contract target.`,
      confirmLabel: "Remove grant override",
      targetLabel: "Contract",
      targetName: group.contractId,
      expectedValue: group.contractId,
    });
    if (confirmed) await removeGrantOverrideGroup(group);
  }

  onMount(() => { void load(); });
</script>

<section class="space-y-4">
  <PageToolbar title="Grants" description="Review authority deployment grant overrides that pre-authorize matching web origins and session keys.">
    {#snippet actions()}
      <label class="sr-only" for="grant-search">Search grant overrides</label>
      <input id="grant-search" class="input input-bordered input-sm w-72" placeholder="Search grants" bind:value={search} />
      <a class="btn btn-outline btn-sm" href={resolve("/admin/grants/new")}>New grant</a>
      <button class="btn btn-ghost btn-sm" onclick={() => void load()} disabled={busy}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}
  {#if saved}
    <div class="alert alert-success"><span>{saved}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading deployment grant overrides" /></Panel>
  {:else}
    <div class="flex flex-col gap-3 border-y border-base-300 bg-base-100/45 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
      <div class="min-w-0">
        <p class="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-base-content/45">Grant override policy</p>
        <p class="mt-1 text-sm text-base-content/60">Overrides can satisfy approval prompts when an enabled authority deployment makes a matching web origin or session key request available.</p>
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <span class="badge badge-ghost badge-sm">{groupGrantOverrides(rows).length} grants</span>
        <span class="badge badge-outline badge-sm">{rows.length} stored references</span>
        <span class="badge badge-outline badge-sm">{filteredGrantGroups.length} visible</span>
      </div>
    </div>

    <Panel title="Grant overrides" eyebrow="Primary policy table">
      {#if rows.length === 0}
        <EmptyState title="No grant overrides" description="No authority deployment grant overrides are configured across the loaded envelopes." />
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-xs trellis-table grants-table border-b border-base-300 bg-base-100/30">
            <colgroup>
              <col style="width: 11%" />
              <col style="width: 22%" />
              <col style="width: 20%" />
              <col style="width: 20%" />
              <col style="width: 21%" />
              <col style="width: 6%" />
            </colgroup>
            <thead>
              <tr>
                <th>Identity</th>
                <th>Contract</th>
                <th>Origin</th>
                <th>Session key</th>
                <th>Capabilities / groups</th>
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredGrantGroups as group (group.key)}
                <tr>
                  <td class="align-top"><span class="badge badge-outline badge-xs">{group.identityKind}</span></td>
                  <td class="align-top"><div class="trellis-identifier min-w-0 truncate" title={group.contractId}>{group.contractId}</div></td>
                  <td class="align-top"><div class="trellis-identifier min-w-0 truncate" title={group.origin ?? "Web grants only"}>{group.origin ?? "—"}</div></td>
                  <td class="align-top"><div class="trellis-identifier min-w-0 truncate" title={group.sessionPublicKey ?? "Session grants only"}>{group.sessionPublicKey ?? "—"}</div></td>
                  <td class="align-top">
                    {#if group.directCapabilities.length > 0}
                      <div class="text-xs font-medium text-base-content/65">Direct capabilities</div>
                      <div class="trellis-identifier mt-1 max-h-16 overflow-auto break-all text-xs text-base-content/70" title={group.directCapabilities.join("\n")}>{group.directCapabilities.join(", ")}</div>
                    {/if}
                    {#if group.capabilityGroupKeys.length > 0}
                      <div class={["text-xs font-medium text-base-content/65", group.directCapabilities.length > 0 && "mt-2"]}>Capability groups</div>
                      <div class="trellis-identifier mt-1 max-h-16 overflow-auto break-all text-xs text-base-content/70" title={group.capabilityGroupKeys.join("\n")}>{group.capabilityGroupKeys.join(", ")}</div>
                    {/if}
                  </td>
                  <td class="whitespace-nowrap text-right align-top">
                    <button class="btn btn-ghost btn-xs" onclick={() => requestRemoveGrantOverrideGroup(group)} disabled={busy || removingKey === group.key} aria-label={`Remove grant override for ${group.contractId}`}>
                      {removingKey === group.key ? "..." : "Remove"}
                    </button>
                  </td>
                </tr>
              {:else}
                <tr><td colspan="6" class="text-base-content/55">No grant overrides match the current filter.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Panel>
  {/if}
</section>

<ConfirmationModal bind:this={confirmationModal} />

<style>
  .grants-table {
    min-width: 920px;
    table-layout: fixed;
    width: 100%;
  }

  .grants-table thead {
    background-color: color-mix(in oklab, var(--color-base-content) 3.5%, transparent);
  }
</style>
