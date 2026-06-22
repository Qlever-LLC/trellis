<script lang="ts">
  import { isErr, type BaseError, type Result } from "@qlever-llc/result";
  import type { DeploymentAuthority, DeploymentAuthorityMaterialization, DeploymentAuthorityPlan } from "@qlever-llc/trellis/auth";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import {
    type AuthorityCapabilityDefinition,
    authorityCounts,
    authorityPlanRows,
    createsCapabilityRows,
    deltaContractRows,
    deltaResourceRows,
    deltaSurfaceRows,
    formatBindingTarget,
    givenCapabilityRows,
  } from "$lib/authority_console";
  import { errorMessage, formatDate } from "../../../../../lib/format";
  import { getTrellis } from "../../../../../lib/trellis";

  type ResourceKind = "kv" | "store" | "jobs" | "event-consumer" | "transfer";
  type Binding = { deploymentId: string; kind: ResourceKind; alias: string; binding: Record<string, unknown>; limits: Record<string, unknown> | null; createdAt: string; updatedAt: string };
  type MaterializedAuthority = DeploymentAuthorityMaterialization & { resourceBindings: Binding[] };
  type AuthorityDetail = { authority: DeploymentAuthority; materializedAuthority: MaterializedAuthority | null; portalRoute: unknown; grantOverrides: unknown[]; capabilityDefinitions?: AuthorityCapabilityDefinition[] };
  type ReconcileResponse = { authority: DeploymentAuthority; materializedAuthority: MaterializedAuthority };
  type CapabilitiesListResponse = { entries?: AuthorityCapabilityDefinition[] };
  type ServiceInstance = { deploymentId: string; instanceId: string; disabled: boolean; createdAt?: string };
  type ListResponse<T> = { entries?: T[] };
  type RpcTakeable<T> = { take(): Promise<T | Result<never, BaseError>> };
  type AuthorityRequest = {
    (method: "Auth.DeploymentAuthority.Get", input: { deploymentId: string }): RpcTakeable<AuthorityDetail>;
    (method: "Auth.DeploymentAuthority.Reconcile", input: { deploymentId: string; desiredVersion?: string }): RpcTakeable<ReconcileResponse>;
    (method: "Auth.DeploymentAuthority.Plans.List", input: { deploymentId: string; limit: number; offset?: number }): RpcTakeable<{ entries?: DeploymentAuthorityPlan[] }>;
    (method: "Auth.ServiceInstances.List", input: { limit: number; offset: number }): RpcTakeable<ListResponse<ServiceInstance>>;
    (method: "Auth.Capabilities.List", input: { limit: number; offset: number }): RpcTakeable<CapabilitiesListResponse>;
  };
  type Tab = "desired" | "materialized" | "resources" | "capabilities" | "instances" | "plans";

  const trellis = getTrellis();
  const request = trellis.request.bind(trellis) as AuthorityRequest;
  const selectedDeploymentId = $derived(decodeURIComponent(page.url.pathname.split("/").filter(Boolean).at(-1) ?? ""));
  const tabs: Tab[] = ["desired", "materialized", "resources", "capabilities", "instances", "plans"];
  const authorityPlansHref = resolve("/admin/authority/plans");

  let loading = $state(true);
  let reconciling = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let detail = $state.raw<AuthorityDetail | null>(null);
  let instances = $state.raw<ServiceInstance[]>([]);
  let plans = $state.raw<DeploymentAuthorityPlan[]>([]);
  let capabilityDefinitions = $state.raw<AuthorityCapabilityDefinition[]>([]);
  let activeTab = $state<Tab>("desired");

  const authority = $derived(detail?.authority ?? null);
  const materializedAuthority = $derived(detail?.materializedAuthority ?? null);
  const materializedGrantCount = $derived(
    (materializedAuthority?.grants.capabilities.length ?? 0) +
      (materializedAuthority?.grants.surfaces.length ?? 0) +
      (materializedAuthority?.grants.nats.length ?? 0),
  );
  const counts = $derived(authority ? authorityCounts(authority.desiredState) : null);
  const selectedInstances = $derived(instances.filter((instance) => instance.deploymentId === selectedDeploymentId));
  const desiredContractRows = $derived(authority ? deltaContractRows(authority.desiredState) : []);
  const desiredSurfaceRows = $derived(authority ? deltaSurfaceRows(authority.desiredState) : []);
  const desiredResourceRows = $derived(authority ? deltaResourceRows(authority.desiredState) : []);
  const authorityCapabilityDefinitions = $derived(detail?.capabilityDefinitions ?? capabilityDefinitions);
  const createsRows = $derived(authority ? createsCapabilityRows(authority, authorityCapabilityDefinitions) : []);
  const givenRows = $derived(authority ? givenCapabilityRows(authority, materializedAuthority, authorityCapabilityDefinitions) : []);
  const reconciliationStatus = $derived(materializedAuthority?.status ?? "pending");
  const planRows = $derived.by(() =>
    authorityPlanRows(plans).toSorted((left, right) => {
      if (left.state === "pending" && right.state !== "pending") return -1;
      if (left.state !== "pending" && right.state === "pending") return 1;
      return right.createdAt.localeCompare(left.createdAt);
    })
  );
  const pendingPlanCount = $derived(planRows.filter((plan) => plan.state === "pending").length);

  async function load() {
    loading = true;
    error = null;
    notice = null;
    try {
      const [detailResponse, instancesResponse, plansResponse, capabilitiesResponse] = await Promise.all([
        request("Auth.DeploymentAuthority.Get", { deploymentId: selectedDeploymentId }).take(),
        request("Auth.ServiceInstances.List", { limit: 500, offset: 0 }).take(),
        request("Auth.DeploymentAuthority.Plans.List", { deploymentId: selectedDeploymentId, limit: 500, offset: 0 }).take(),
        request("Auth.Capabilities.List", { limit: 500, offset: 0 }).take(),
      ]);
      if (isErr(detailResponse)) { error = errorMessage(detailResponse); return; }
      if (isErr(instancesResponse)) { error = errorMessage(instancesResponse); return; }
      if (isErr(plansResponse)) { error = errorMessage(plansResponse); return; }
      if (isErr(capabilitiesResponse)) { error = errorMessage(capabilitiesResponse); return; }
      detail = detailResponse;
      instances = instancesResponse.entries ?? [];
      plans = plansResponse.entries ?? [];
      capabilityDefinitions = capabilitiesResponse.entries ?? [];
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  async function reconcile() {
    if (!authority) return;
    reconciling = true;
    error = null;
    notice = null;
    try {
      const response = await request("Auth.DeploymentAuthority.Reconcile", { deploymentId: authority.deploymentId, desiredVersion: authority.version }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      detail = {
        authority: response.authority,
        materializedAuthority: response.materializedAuthority,
        portalRoute: detail?.portalRoute ?? null,
        grantOverrides: detail?.grantOverrides ?? [],
        capabilityDefinitions: detail?.capabilityDefinitions,
      };
      notice = "Reconciliation completed for the current deployment authority.";
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      reconciling = false;
    }
  }

  function tabLabel(tab: Tab): string {
    return tab[0].toUpperCase() + tab.slice(1);
  }

  function statusVariant(status: string): "healthy" | "degraded" | "unhealthy" | "offline" {
    if (status === "current" || status === "Enabled" || status === "accepted" || status === "granted") return "healthy";
    if (status === "pending" || status === "running") return "degraded";
    if (status === "failed" || status === "Disabled" || status === "rejected" || status === "not-materialized") return "unhealthy";
    return "offline";
  }

  function materializedStatusLabel(status: string): string {
    return status === "not-materialized" ? "not materialized" : status;
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Deployment authority" description="Inspect desired authority, materialized authority, and reconciliation for this service deployment.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/(app)/admin/services")}>Back to services</a>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
      <button class="btn btn-warning btn-outline btn-sm" onclick={reconcile} disabled={!authority || reconciling}>{reconciling ? "Reconciling…" : "Reconcile"}</button>
    {/snippet}
  </PageToolbar>

  {#if error}<Notice variant="error">{error}</Notice>{/if}
  {#if notice}<Notice variant="success">{notice}</Notice>{/if}

  {#if loading}
    <Panel><LoadingState label="Loading deployment authority" /></Panel>
  {:else if !authority}
    <Panel><EmptyState title="Deployment authority unavailable" description="The selected service does not have a deployment authority record." /></Panel>
  {:else}
    {#if pendingPlanCount > 0}
      <Notice variant="warning" class="items-start">
        <div class="min-w-0">
          <div class="font-medium">Pending authority plan{pendingPlanCount === 1 ? "" : "s"}</div>
          <div class="mt-1 text-sm">Review pending authority changes before reconciling this deployment.</div>
        </div>
        <a class="btn btn-warning btn-outline btn-sm" href={authorityPlansHref}>Open plans</a>
      </Notice>
    {/if}

    <Panel>
      <div class="flex flex-wrap items-start justify-between gap-3 border-b border-base-300 pb-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="trellis-identifier truncate text-lg font-semibold">{authority.deploymentId}</h2>
            <StatusBadge label={authority.disabled ? "Disabled" : "Enabled"} status={statusVariant(authority.disabled ? "Disabled" : "Enabled")} />
            <StatusBadge label={`Materialized ${reconciliationStatus}`} status={statusVariant(reconciliationStatus)} />
          </div>
          <div class="mt-1 text-sm text-base-content/60">Desired version <span class="trellis-identifier">{authority.version}</span> · updated {formatDate(authority.updatedAt)}</div>
        </div>
        <div class="flex flex-wrap gap-2 text-sm">
          <span class="badge badge-outline badge-sm">{counts?.requiredContracts ?? 0} required contracts</span>
          <span class="badge badge-outline badge-sm">{desiredSurfaceRows.length} surfaces</span>
          <span class="badge badge-outline badge-sm">{desiredResourceRows.length} resources</span>
          <span class="badge badge-outline badge-sm">{createsRows.length} Creates</span>
          <span class="badge badge-outline badge-sm">{givenRows.length} Given</span>
        </div>
      </div>

      {#if materializedAuthority?.status === "pending"}
        <Notice variant="warning" class="mt-3">Reconciliation pending: materialized authority has not caught up to desired version {authority.version}.</Notice>
      {:else if materializedAuthority?.status === "failed"}
        <Notice variant="error" class="mt-3">Reconciliation failed{materializedAuthority.error ? `: ${materializedAuthority.error}` : ""}</Notice>
      {/if}

      <div class="tabs tabs-box tabs-sm mt-4 w-fit bg-base-200/70 p-1" role="tablist" aria-label="Deployment authority sections">
        {#each tabs as tab (tab)}
          <button type="button" role="tab" aria-selected={activeTab === tab} class={["tab rounded-field px-4", activeTab === tab && "tab-active bg-base-100 shadow-sm"]} onclick={() => (activeTab = tab)}>{tabLabel(tab)}</button>
        {/each}
      </div>

      <div class="mt-4">
        {#if activeTab === "desired"}
          <div class="grid gap-4 lg:grid-cols-2">
            <Panel title="Desired contracts" class="min-w-0">
              {#if desiredContractRows.length === 0}<EmptyState title="No desired contracts" description="Contract proposal requirements will appear after authority updates are accepted." />{:else}
                <DataTable><thead><tr><th>Contract</th><th>Availability</th></tr></thead><tbody>{#each desiredContractRows as row (row.id)}<tr><td class="trellis-identifier">{row.contractId}</td><td><span class="badge badge-outline badge-xs">{row.availability}</span></td></tr>{/each}</tbody></DataTable>
              {/if}
            </Panel>
            <Panel title="Desired surfaces" class="min-w-0">
              {#if desiredSurfaceRows.length === 0}<EmptyState title="No desired surfaces" description="Accepted authority updates add surface needs here." />{:else}
                <DataTable><thead><tr><th>Surface</th><th>Kind</th><th>Action</th><th>Availability</th></tr></thead><tbody>{#each desiredSurfaceRows as row (row.id)}<tr><td><div class="trellis-identifier">{row.name}</div><div class="trellis-identifier text-xs text-base-content/50">{row.contractId}</div></td><td>{row.kind}</td><td>{row.action}</td><td><span class="badge badge-outline badge-xs">{row.availability}</span></td></tr>{/each}</tbody></DataTable>
              {/if}
            </Panel>
          </div>
        {:else if activeTab === "materialized"}
          {#if !materializedAuthority}
            <EmptyState title="No materialized authority" description="Run reconciliation after accepting an authority update or migration." />
          {:else}
            <DataTable><thead><tr><th>Desired version</th><th>Status</th><th>Reconciled</th><th>Grants</th></tr></thead><tbody><tr><td class="trellis-identifier">{materializedAuthority.desiredVersion}</td><td><StatusBadge label={materializedAuthority.status} status={statusVariant(materializedAuthority.status)} /></td><td>{materializedAuthority.reconciledAt ? formatDate(materializedAuthority.reconciledAt) : "—"}</td><td>{materializedGrantCount}</td></tr></tbody></DataTable>
          {/if}
        {:else if activeTab === "resources"}
          <DataTable><thead><tr><th>Resource</th><th>Availability</th><th>Materialized binding</th></tr></thead><tbody>{#each desiredResourceRows as row (row.id)}{@const binding = materializedAuthority?.resourceBindings.find((item) => item.kind === row.kind && item.alias === row.alias)}<tr><td><div class="trellis-identifier">{row.alias}</div><div class="text-xs text-base-content/60">{row.kind}</div></td><td><span class="badge badge-outline badge-xs">{row.availability}</span></td><td class="trellis-identifier text-xs">{binding ? formatBindingTarget(binding) : "not materialized"}</td></tr>{:else}<tr><td colspan="3"><EmptyState title="No resources" description="This deployment authority has no desired resource needs." /></td></tr>{/each}</tbody></DataTable>
        {:else if activeTab === "capabilities"}
          <div class="space-y-4">
            <div class="rounded-box border border-base-300 bg-base-100">
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 px-3 py-2">
                <div>
                  <h3 class="font-medium">Creates</h3>
                  <p class="text-xs text-base-content/60">Capability definitions this deployment provides for other participants.</p>
                </div>
                <span class="badge badge-outline badge-sm">{createsRows.length}</span>
              </div>
              <DataTable><thead><tr><th>Capability</th><th>Definition</th><th>Source</th><th>Contract</th></tr></thead><tbody>{#each createsRows as row (row.id)}<tr><td><div class="trellis-identifier font-medium">{row.capability}</div>{#if row.consequence}<div class="text-xs text-base-content/60">{row.consequence}</div>{/if}</td><td><div>{row.displayName}</div><div class="text-xs text-base-content/60">{row.description}</div></td><td><span class="badge badge-outline badge-xs">{row.source}</span></td><td><div class="trellis-identifier text-xs">{row.contractId ?? "platform"}</div>{#if row.contractDigest}<div class="trellis-identifier text-xs text-base-content/50">{row.contractDigest}</div>{/if}</td></tr>{:else}<tr><td colspan="4"><EmptyState title="No Creates capabilities" description="No capability definitions for this deployment are available from authority APIs." /></td></tr>{/each}</tbody></DataTable>
            </div>

            <div class="rounded-box border border-base-300 bg-base-100">
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 px-3 py-2">
                <div>
                  <h3 class="font-medium">Given</h3>
                  <p class="text-xs text-base-content/60">Capability needs accepted for this deployment and the matching materialized grants.</p>
                </div>
                <span class="badge badge-outline badge-sm">{givenRows.length}</span>
              </div>
              <DataTable><thead><tr><th>Capability</th><th>Need</th><th>Materialized</th><th>Definition</th><th>Contract</th></tr></thead><tbody>{#each givenRows as row (row.id)}<tr><td><div class="trellis-identifier font-medium">{row.capability}</div>{#if row.consequence}<div class="text-xs text-base-content/60">{row.consequence}</div>{/if}</td><td><span class="badge badge-outline badge-xs">{row.availability}</span></td><td><StatusBadge label={materializedStatusLabel(row.materializedStatus)} status={statusVariant(row.materializedStatus)} />{#if row.materializedGrantCount > 1}<div class="mt-1 text-xs text-base-content/60">{row.materializedGrantCount} grants</div>{/if}</td><td><div>{row.displayName}</div><div class="text-xs text-base-content/60">{row.description}</div><div class="mt-1"><span class="badge badge-outline badge-xs">{row.source}</span></div></td><td><div class="trellis-identifier text-xs">{row.contractId ?? "authority"}</div>{#if row.contractDigest}<div class="trellis-identifier text-xs text-base-content/50">{row.contractDigest}</div>{/if}</td></tr>{:else}<tr><td colspan="5"><EmptyState title="No Given capabilities" description="This deployment authority has no accepted capability needs or materialized capability grants." /></td></tr>{/each}</tbody></DataTable>
            </div>
          </div>
        {:else if activeTab === "instances"}
          <DataTable><thead><tr><th>Instance</th><th>Status</th><th>Created</th></tr></thead><tbody>{#each selectedInstances as instance (instance.instanceId)}<tr><td class="trellis-identifier">{instance.instanceId}</td><td><StatusBadge label={instance.disabled ? "Disabled" : "Enabled"} status={statusVariant(instance.disabled ? "Disabled" : "Enabled")} /></td><td>{instance.createdAt ? formatDate(instance.createdAt) : "—"}</td></tr>{:else}<tr><td colspan="3"><EmptyState title="No runtime instances" description="Service runtime instances appear after they connect." /></td></tr>{/each}</tbody></DataTable>
        {:else if activeTab === "plans"}
          <DataTable><thead><tr><th>Plan</th><th>State</th><th>Class</th><th>Diff preview</th><th>Created</th></tr></thead><tbody>{#each planRows as row (row.planId)}<tr><td><a class="trellis-identifier font-medium link-hover" href={resolve(`/admin/authority/plans/${encodeURIComponent(row.planId)}`)}>{row.planId}</a></td><td><StatusBadge label={row.state} status={statusVariant(row.state)} /></td><td><span class="badge badge-outline badge-xs">{row.classification}</span></td><td>{row.requiredContracts + row.optionalContracts} contracts · {row.requiredSurfaces + row.optionalSurfaces} surfaces · {row.resources} resources · {row.capabilities} capabilities</td><td>{formatDate(row.createdAt)}</td></tr>{:else}<tr><td colspan="5"><EmptyState title="No authority plans" description="This deployment has no pending or historical authority plans." /></td></tr>{/each}</tbody></DataTable>
        {/if}
      </div>
    </Panel>
  {/if}
</section>
