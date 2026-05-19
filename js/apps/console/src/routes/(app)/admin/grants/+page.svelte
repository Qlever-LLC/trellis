<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthEnvelopesGetResponse,
    DeploymentEnvelope,
  } from "@qlever-llc/trellis/auth";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type DeploymentGrantOverride = AuthEnvelopesGetResponse["grantOverrides"][number];
  type GrantIdentityKind = DeploymentGrantOverride["identityKind"];
  type GrantStatus = "Broad" | "Scoped";
  type GrantOverrideMutationInput = {
    deploymentId: string;
    overrides: DeploymentGrantOverride[];
  };
  type GrantOverrideRpcClient = {
    request(
      subject: "Auth.Envelopes.GrantOverrides.Put" | "Auth.Envelopes.GrantOverrides.Remove",
      input: GrantOverrideMutationInput,
    ): { take(): Promise<unknown> };
  };
  type GrantOverrideRow = DeploymentGrantOverride & {
    envelope: DeploymentEnvelope;
  };

  const trellis = getTrellis();
  const grantOverrideRpc = trellis as GrantOverrideRpcClient;
  const grantIdentityKinds: GrantIdentityKind[] = ["any", "web", "cli", "native", "device-user"];

  let loading = $state(true);
  let saving = $state(false);
  let removingKey = $state<string | null>(null);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let search = $state("");
  let deployments = $state.raw<DeploymentEnvelope[]>([]);
  let rows = $state.raw<GrantOverrideRow[]>([]);
  let selectedDeploymentId = $state("");
  let identityKind = $state<GrantIdentityKind>("any");
  let contractId = $state("");
  let origin = $state("");
  let sessionPublicKey = $state("");
  let devicePublicKey = $state("");
  let capability = $state("");

  const busy = $derived(loading || saving || removingKey !== null);
  const deploymentOptions = $derived(deployments.toSorted((left, right) => left.deploymentId.localeCompare(right.deploymentId)));
  const broadGrantCount = $derived(rows.filter((row) => grantStatus(row) === "Broad").length);
  const filteredRows = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => searchableGrantText(row).includes(term));
  });
  const rowsByDeployment = $derived.by(() => {
    const groups: Record<string, DeploymentGrantOverride[]> = {};
    for (const row of rows) {
      groups[row.deploymentId] = [...(groups[row.deploymentId] ?? []), rowToOverride(row)];
    }
    return groups;
  });

  function trimmedOptional(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function grantOverrideKey(override: DeploymentGrantOverride): string {
    return [
      override.deploymentId,
      override.identityKind,
      override.contractId ?? "*",
      override.origin ?? "*",
      override.sessionPublicKey ?? "*",
      override.devicePublicKey ?? "*",
      override.capability,
    ].join("|");
  }

  function rowToOverride(row: GrantOverrideRow): DeploymentGrantOverride {
    return {
      deploymentId: row.deploymentId,
      identityKind: row.identityKind,
      contractId: row.contractId,
      origin: row.origin,
      sessionPublicKey: row.sessionPublicKey,
      devicePublicKey: row.devicePublicKey,
      capability: row.capability,
    };
  }

  function sameGrantOverride(left: DeploymentGrantOverride, right: DeploymentGrantOverride): boolean {
    return grantOverrideKey(left) === grantOverrideKey(right);
  }

  function searchableGrantText(row: GrantOverrideRow): string {
    return [
      row.deploymentId,
      row.identityKind,
      row.contractId ?? "",
      row.origin ?? "",
      row.sessionPublicKey ?? "",
      row.devicePublicKey ?? "",
      row.capability,
    ].join(" ").toLowerCase();
  }

  function grantStatus(override: DeploymentGrantOverride): GrantStatus {
    return override.identityKind === "any" && override.contractId === null && override.origin === null &&
        override.sessionPublicKey === null && override.devicePublicKey === null
      ? "Broad"
      : "Scoped";
  }

  function resetForm(): void {
    identityKind = "any";
    contractId = "";
    origin = "";
    sessionPublicKey = "";
    devicePublicKey = "";
    capability = "";
  }

  function buildOverride(): DeploymentGrantOverride | null {
    const deploymentId = selectedDeploymentId.trim();
    const grantCapability = capability.trim();
    if (!deploymentId || !grantCapability) return null;
    return {
      deploymentId,
      identityKind,
      contractId: trimmedOptional(contractId),
      origin: trimmedOptional(origin),
      sessionPublicKey: trimmedOptional(sessionPublicKey),
      devicePublicKey: trimmedOptional(devicePublicKey),
      capability: grantCapability,
    };
  }

  async function load(): Promise<void> {
    loading = true;
    error = null;
    saved = null;
    try {
      const listResponse = await trellis.request("Auth.Envelopes.List", { limit: 500, offset: 0 }).take();
      if (isErr(listResponse)) {
        error = errorMessage(listResponse);
        deployments = [];
        rows = [];
        return;
      }

      deployments = listResponse.entries;
      selectedDeploymentId = selectedDeploymentId || deployments[0]?.deploymentId || "";

      const details = await Promise.all(deployments.map((deployment) => loadDeploymentGrantOverrides(deployment)));
      rows = details.flat().sort((left, right) => grantOverrideKey(left).localeCompare(grantOverrideKey(right)));
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function loadDeploymentGrantOverrides(deployment: DeploymentEnvelope): Promise<GrantOverrideRow[]> {
    const response = await trellis.request("Auth.Envelopes.Get", { deploymentId: deployment.deploymentId }).take();
    if (isErr(response)) throw new Error(`Failed to load ${deployment.deploymentId}: ${errorMessage(response)}`);
    return response.grantOverrides.map((override) => ({ ...override, envelope: deployment }));
  }

  async function addGrantOverride(): Promise<void> {
    const nextOverride = buildOverride();
    if (!nextOverride) {
      error = "Select a deployment and enter a capability.";
      return;
    }

    const existing = rowsByDeployment[nextOverride.deploymentId] ?? [];
    if (existing.some((override) => sameGrantOverride(override, nextOverride))) {
      saved = "Grant override already exists; no changes saved.";
      error = null;
      return;
    }

    saving = true;
    error = null;
    saved = null;
    try {
      const response = await grantOverrideRpc.request("Auth.Envelopes.GrantOverrides.Put", {
        deploymentId: nextOverride.deploymentId,
        overrides: [...existing, nextOverride],
      }).take();
      if (isErr(response)) {
        error = errorMessage(response);
        return;
      }
      saved = `Added grant override for ${nextOverride.deploymentId}.`;
      resetForm();
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  async function removeGrantOverride(row: GrantOverrideRow): Promise<void> {
    const override = rowToOverride(row);
    if (!confirm(`Remove grant override ${override.capability} from ${override.deploymentId}?`)) return;
    const key = grantOverrideKey(override);
    removingKey = key;
    error = null;
    saved = null;
    try {
      const response = await grantOverrideRpc.request("Auth.Envelopes.GrantOverrides.Remove", {
        deploymentId: override.deploymentId,
        overrides: [override],
      }).take();
      if (isErr(response)) {
        error = errorMessage(response);
        return;
      }
      saved = "Removed grant override.";
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      removingKey = null;
    }
  }

  onMount(() => { void load(); });
</script>

<section class="space-y-4">
  <PageToolbar title="Grants" description="Review deployment-owned grant overrides that pre-authorize matching app, CLI, native, and device-user access.">
    {#snippet actions()}
      <label class="sr-only" for="grant-search">Search grant overrides</label>
      <input id="grant-search" class="input input-bordered input-sm w-72" placeholder="Search grants" bind:value={search} />
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={busy}>Refresh</button>
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
        <p class="mt-1 text-sm text-base-content/60">Overrides can satisfy approval prompts, but only when deployment availability already covers the requested contract boundary.</p>
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <span class="badge badge-ghost badge-sm">{rows.length} total</span>
        <span class="badge badge-outline badge-sm">{filteredRows.length} visible</span>
        {#if broadGrantCount > 0}
          <span class="badge badge-warning badge-sm">{broadGrantCount} broad</span>
        {/if}
      </div>
    </div>

    <Panel title="Grant overrides" eyebrow="Primary policy table">
      {#if rows.length === 0}
        <EmptyState title="No grant overrides" description="No deployment grant overrides are configured across the loaded envelopes." />
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-xs trellis-table grants-table border-b border-base-300 bg-base-100/30">
            <colgroup>
              <col class="w-[16%]" />
              <col class="w-[10%]" />
              <col class="w-[14%]" />
              <col class="w-[14%]" />
              <col class="w-[14%]" />
              <col class="w-[14%]" />
              <col class="w-[14%]" />
              <col class="w-[8%]" />
              <col class="w-[6%]" />
            </colgroup>
            <thead>
              <tr>
                <th>Deployment</th>
                <th>Identity</th>
                <th>Contract</th>
                <th>Origin</th>
                <th>Session key</th>
                <th>Device key</th>
                <th>Capability</th>
                <th>Scope</th>
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredRows as row (grantOverrideKey(row))}
                <tr>
                  <td class="max-w-0 align-top">
                    <div class="trellis-identifier truncate font-semibold" title={row.deploymentId}>{row.deploymentId}</div>
                    <div class="text-xs text-base-content/50">{row.envelope.kind}{row.envelope.disabled ? " · disabled" : ""}</div>
                  </td>
                  <td class="align-top"><span class="badge badge-outline badge-xs">{row.identityKind}</span></td>
                  <td class="trellis-identifier max-w-0 truncate align-top" title={row.contractId ?? "Any"}>{row.contractId ?? "Any"}</td>
                  <td class="trellis-identifier max-w-0 truncate align-top" title={row.origin ?? "Any"}>{row.origin ?? "Any"}</td>
                  <td class="trellis-identifier max-w-0 truncate align-top" title={row.sessionPublicKey ?? "Any"}>{row.sessionPublicKey ?? "Any"}</td>
                  <td class="trellis-identifier max-w-0 truncate align-top" title={row.devicePublicKey ?? "Any"}>{row.devicePublicKey ?? "Any"}</td>
                  <td class="trellis-identifier max-w-0 truncate align-top" title={row.capability}>{row.capability}</td>
                  <td class="align-top"><span class={["badge badge-xs", grantStatus(row) === "Broad" ? "badge-warning" : "badge-ghost"]}>{grantStatus(row)}</span></td>
                  <td class="whitespace-nowrap text-right align-top">
                    <button class="btn btn-ghost btn-xs" onclick={() => removeGrantOverride(row)} disabled={busy || removingKey === grantOverrideKey(row)} aria-label={`Remove grant override for ${row.capability}`}>
                      {removingKey === grantOverrideKey(row) ? "..." : "Remove"}
                    </button>
                  </td>
                </tr>
              {:else}
                <tr><td colspan="9" class="text-base-content/55">No grant overrides match the current filter.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Panel>

    <Panel title="Add grant override" eyebrow="append to deployment override set">
      <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <label class="form-control">
          <span class="label-text text-xs">Deployment</span>
          <select class="select select-bordered select-sm trellis-identifier" bind:value={selectedDeploymentId} disabled={deploymentOptions.length === 0}>
            {#each deploymentOptions as deployment (deployment.deploymentId)}
              <option value={deployment.deploymentId}>{deployment.deploymentId}</option>
            {/each}
          </select>
        </label>
        <label class="form-control">
          <span class="label-text text-xs">Identity kind</span>
          <select class="select select-bordered select-sm" bind:value={identityKind}>
            {#each grantIdentityKinds as kind (kind)}<option value={kind}>{kind}</option>{/each}
          </select>
        </label>
        <label class="form-control">
          <span class="label-text text-xs">Contract id</span>
          <input class="input input-bordered input-sm trellis-identifier" placeholder="Any contract" bind:value={contractId} />
        </label>
        <label class="form-control">
          <span class="label-text text-xs">Origin</span>
          <input class="input input-bordered input-sm trellis-identifier" placeholder="Any origin" bind:value={origin} />
        </label>
        <label class="form-control">
          <span class="label-text text-xs">Session key</span>
          <input class="input input-bordered input-sm trellis-identifier" placeholder="Any session key" bind:value={sessionPublicKey} />
        </label>
        <label class="form-control">
          <span class="label-text text-xs">Device key</span>
          <input class="input input-bordered input-sm trellis-identifier" placeholder="Any device key" bind:value={devicePublicKey} />
        </label>
        <label class="form-control xl:col-span-2">
          <span class="label-text text-xs">Capability</span>
          <input class="input input-bordered input-sm trellis-identifier" placeholder="capability.key" bind:value={capability} />
        </label>
      </div>
      <div class="mt-3 flex items-center justify-between gap-2">
        <p class="text-xs text-base-content/55">Blank contract, origin, session key, and device key fields match any value.</p>
        <button class="btn btn-primary btn-sm" onclick={addGrantOverride} disabled={busy || !selectedDeploymentId || !capability.trim()}>{saving ? "Saving..." : "Add grant"}</button>
      </div>
    </Panel>
  {/if}
</section>

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
