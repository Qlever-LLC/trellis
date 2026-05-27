<script lang="ts">
  import { isErr, type BaseError, type Result } from "@qlever-llc/result";
  import { ok } from "@qlever-llc/result";
  import type { AuthEnvelopeExpansionsListResponse } from "@qlever-llc/trellis/auth";
  import type { HealthHeartbeat } from "@qlever-llc/trellis/health";
  import type {
    AuthDeploymentsListOutput,
    AuthServiceInstancesListOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import type { TrellisCatalogOutput } from "@qlever-llc/trellis/sdk/core";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { expansionRequestRows, type ExpansionRequestRow } from "$lib/envelope_console";
  import {
    pruneExpiredHealthInstances,
    summarizeHealthServices,
    upsertHealthInstance,
    type HealthInstanceView,
    type HealthServiceView,
  } from "../../../../lib/health_events.ts";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { getTrellis } from "../../../../lib/trellis";

  type Deployment = Extract<AuthDeploymentsListOutput["entries"][number], { kind: "service" }>;
  type ServiceInstance = AuthServiceInstancesListOutput["entries"][number];
  type CatalogContract = TrellisCatalogOutput["catalog"]["contracts"][number];
  type ExpansionRequest = AuthEnvelopeExpansionsListResponse["entries"][number];
  type ContractRef = { contractId: string; digest: string };
  type RpcTakeable<T> = { take(): Promise<T | Result<never, BaseError>> };
  type CoreRequest = {
    (method: "Trellis.Catalog", input: Record<string, never>): RpcTakeable<TrellisCatalogOutput>;
  };

  const trellis = getTrellis();
  const coreRequest = trellis.request.bind(trellis) as CoreRequest;
  const STALE_REFRESH_MS = 5_000;

  let loading = $state(true);
  let error = $state<string | null>(null);
  let subscriptionError = $state<string | null>(null);
  let catalogError = $state<string | null>(null);
  let deployments = $state.raw<Deployment[]>([]);
  let instances = $state.raw<ServiceInstance[]>([]);
  let expansionRequests = $state.raw<ExpansionRequest[]>([]);
  let catalogContracts = $state.raw<CatalogContract[]>([]);
  let healthInstances = $state.raw<Record<string, HealthInstanceView>>({});
  let now = $state(Date.now());
  let search = $state("");

  const healthServices = $derived(summarizeHealthServices(healthInstances, now));
  const serviceDeploymentIds = $derived(new Set(deployments.map((deployment) => deployment.deploymentId)));
  const pendingExpansionRequestRows = $derived.by(() =>
    expansionRequestRows(expansionRequests)
      .filter((request) => request.state === "pending" && serviceDeploymentIds.has(request.deploymentId))
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
  );
  const filteredDeployments = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return deployments;
    return deployments.filter((deployment) => deployment.deploymentId.toLowerCase().includes(term));
  });
  const disabledCount = $derived(deployments.filter((deployment) => deployment.disabled).length);

  function contractRefsForHealthService(service: HealthServiceView | null): ContractRef[] {
    const refs: ContractRef[] = [];
    for (const instance of service?.instances ?? []) {
      const id = instance.contractId.trim();
      const digest = instance.contractDigest.trim();
      if (!id || !digest) continue;
      const exists = refs.some((ref) => ref.contractId === id && ref.digest === digest);
      if (!exists) refs.push({ contractId: id, digest });
    }
    return refs;
  }

  function healthServiceForDeployment(deploymentId: string, serviceInstances: ServiceInstance[], services: HealthServiceView[]): HealthServiceView | null {
    const byServiceName = services.find((service) => service.serviceName === deploymentId);
    if (byServiceName) return byServiceName;
    const instanceIds = serviceInstances.map((instance) => instance.instanceId);
    const byRuntimeInstance = services.find((service) => service.instances.some((instance) => instanceIds.includes(instance.instanceId)));
    if (byRuntimeInstance) return byRuntimeInstance;
    return null;
  }

  function statusLabel(status: string): string {
    if (status === "healthy") return "Healthy";
    if (status === "degraded") return "Degraded";
    if (status === "unhealthy") return "Unhealthy";
    if (status === "offline") return "Offline";
    return status;
  }

  function badgeClassForStatus(status: string): string {
    if (status === "Healthy" || status === "healthy") return "badge-success";
    if (status === "Degraded" || status === "degraded") return "badge-warning";
    if (status === "Unhealthy" || status === "unhealthy") return "badge-error";
    return "badge-neutral";
  }

  function dotClassForStatus(status: string): string {
    if (status === "Healthy" || status === "healthy") return "bg-success";
    if (status === "Degraded" || status === "degraded") return "bg-warning";
    if (status === "Unhealthy" || status === "unhealthy") return "bg-error";
    return "bg-base-content/30";
  }

  function formatSeenAt(value?: number): string {
    return value ? formatDate(new Date(value).toISOString()) : "-";
  }

  function objectRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  function deploymentCompatibilityMode(deployment: Deployment): string {
    const mode = objectRecord(deployment)?.contractCompatibilityMode;
    return typeof mode === "string" ? mode : "strict";
  }

  function contractKind(contract: CatalogContract): string {
    const kind = objectRecord(contract)?.kind;
    return typeof kind === "string" ? kind : "contract";
  }

  function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
  }

  function expansionRequestSummary(request: ExpansionRequestRow): string {
    const contracts = request.requiredContracts + request.optionalContracts;
    const surfaces = request.requiredSurfaces + request.optionalSurfaces;
    return [
      plural(contracts, "contract"),
      plural(surfaces, "surface"),
      plural(request.resources, "resource"),
      plural(request.capabilities, "capability"),
    ].join(" · ");
  }

  async function load() {
    loading = true;
    error = null;
    catalogError = null;
    try {
      const [deploymentsRes, instancesRes, expansionRequestsRes, catalogRes] = await Promise.all([
        trellis.request("Auth.Deployments.List", { kind: "service", limit: 500, offset: 0 }).take(),
        trellis.request("Auth.ServiceInstances.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.EnvelopeExpansions.List", { state: "pending", limit: 500, offset: 0 }).take(),
        coreRequest("Trellis.Catalog", {}).take(),
      ]);
      if (isErr(deploymentsRes)) { error = errorMessage(deploymentsRes); return; }
      if (isErr(instancesRes)) { error = errorMessage(instancesRes); return; }
      if (isErr(expansionRequestsRes)) { error = errorMessage(expansionRequestsRes); return; }
      deployments = (deploymentsRes.entries ?? []).filter((deployment): deployment is Deployment => deployment.kind === "service");
      instances = instancesRes.entries ?? [];
      expansionRequests = expansionRequestsRes.entries ?? [];
      if (isErr(catalogRes)) {
        catalogError = errorMessage(catalogRes);
        catalogContracts = [];
      } else {
        catalogContracts = catalogRes.catalog.contracts ?? [];
      }
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  function ingestHeartbeat(heartbeat: HealthHeartbeat) {
    const receivedAt = Date.now();
    healthInstances = upsertHealthInstance(pruneExpiredHealthInstances(healthInstances, receivedAt), heartbeat, receivedAt);
    now = receivedAt;
  }

  function handleHeartbeat(heartbeat: HealthHeartbeat) {
    ingestHeartbeat(heartbeat);
    return ok(undefined);
  }

  onMount(() => {
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      healthInstances = pruneExpiredHealthInstances(healthInstances, currentTime);
      now = currentTime;
    }, STALE_REFRESH_MS);

    void load();
    void (async () => {
      try {
        const result = await trellis.event.health.heartbeat.listen(handleHeartbeat, {}, {
          mode: "ephemeral",
          replay: "new",
          signal: controller.signal,
        });
        if (result.isErr()) subscriptionError = errorMessage(result.error);
      } catch (cause) {
        subscriptionError = errorMessage(cause);
      }
    })();

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Service runtime" description="Service deployments, runtime instances, active health, and contract documentation.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
      <a class="btn btn-ghost btn-sm" href={resolve("/(app)/admin/services/contracts")}>Contract docs</a>
      <a class="btn btn-outline btn-sm" href={resolve("/(app)/admin/services/new")}>Create service</a>
    {/snippet}
  </PageToolbar>

  {#if error}<Notice variant="error">{error}</Notice>{/if}
  {#if subscriptionError}<Notice variant="warning">Heartbeat subscription unavailable: {subscriptionError}</Notice>{/if}
  {#if catalogError}<Notice variant="warning">Contract catalog unavailable: {catalogError}</Notice>{/if}

  {#if loading}
    <Panel><LoadingState label="Loading services" /></Panel>
  {:else}
    {#if pendingExpansionRequestRows.length > 0}
      <Panel title="Pending authority requests" eyebrow={`${pendingExpansionRequestRows.length} awaiting review`}>
        <DataTable>
          <thead><tr><th>Deployment</th><th>Contract</th><th>Delta</th><th>Requester</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {#each pendingExpansionRequestRows as request (request.requestId)}
              <tr class="hover:bg-base-200/60">
                <td class="trellis-identifier font-medium">{request.deploymentId}</td>
                <td>
                  <div class="trellis-identifier font-medium">{request.contractId}</div>
                  <div class="trellis-identifier text-xs text-base-content/50">{request.contractDigest}</div>
                </td>
                <td>{expansionRequestSummary(request)}</td>
                <td><span class="badge badge-outline badge-xs">{request.requestedByKind}</span></td>
                <td class="text-base-content/60">{formatDate(request.createdAt)}</td>
                <td><a class="btn btn-warning btn-outline btn-xs" href={resolve("/(app)/admin/services/[deploymentId]", { deploymentId: request.deploymentId })}>Review</a></td>
              </tr>
            {/each}
          </tbody>
        </DataTable>
      </Panel>
    {/if}

    <Panel>
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold uppercase tracking-wide text-base-content/70">Services fleet</h2>
          <p class="text-xs text-base-content/50">{deployments.length} deployment{deployments.length === 1 ? "" : "s"} · {disabledCount} disabled / archived</p>
        </div>
        <label class="input input-bordered input-sm flex items-center gap-2">
          <Icon name="search" size={14} class="text-base-content/50" />
          <input bind:value={search} class="grow" placeholder="Search deployments" aria-label="Search deployments" />
        </label>
      </div>

      {#if deployments.length === 0}
        <EmptyState title="No deployments" description="Run services create to add a deployment." />
      {:else}
        <DataTable>
          <thead><tr><th>Deployment</th><th>Status</th><th>Instances</th><th>Mode</th><th>Heartbeat</th><th>Contracts</th></tr></thead>
          <tbody>
            {#each filteredDeployments as deployment (deployment.deploymentId)}
              {@const serviceInstances = instances.filter((instance) => instance.deploymentId === deployment.deploymentId)}
              {@const activeServiceInstances = serviceInstances.filter((instance) => !instance.disabled)}
              {@const healthService = healthServiceForDeployment(deployment.deploymentId, serviceInstances, healthServices)}
              {@const rowStatus = deployment.disabled ? "Disabled" : (healthService ? statusLabel(healthService.status) : (activeServiceInstances.length > 0 ? "Enabled" : "No instances"))}
              {@const refs = contractRefsForHealthService(healthService)}
              <tr class="hover:bg-base-200/60">
                <td class="min-w-72">
                  <a class="btn btn-ghost h-auto min-h-0 justify-start gap-2 px-2 py-1 text-left" href={resolve("/(app)/admin/services/[deploymentId]", { deploymentId: deployment.deploymentId })}>
                    <span class={["h-2.5 w-2.5 rounded-full", dotClassForStatus(rowStatus)]}></span><span class="trellis-identifier font-medium">{deployment.deploymentId}</span>
                  </a>
                </td>
                <td><span class={["badge badge-sm", badgeClassForStatus(rowStatus)]}>{rowStatus}</span></td>
                <td>{activeServiceInstances.length}/{serviceInstances.length} enabled</td>
                <td>{#if deploymentCompatibilityMode(deployment) === "mutable-dev"}<span class="badge badge-warning badge-xs">mutable-dev</span>{:else}<span class="badge badge-outline badge-xs">strict</span>{/if}</td>
                <td class="text-base-content/60">{healthService ? formatSeenAt(healthService.lastSeenAt) : "-"}</td>
                <td>
                  <div class="flex flex-wrap gap-1">
                    {#each refs as ref (`${ref.contractId}:${ref.digest}`)}
                      <a class="badge badge-outline badge-sm trellis-identifier" href={resolve("/(app)/admin/services/contracts/[digest]", { digest: ref.digest })}>{ref.contractId}</a>
                    {:else}
                      <span class="text-xs text-base-content/50">No live contract</span>
                    {/each}
                  </div>
                </td>
              </tr>
            {:else}
              <tr><td colspan="6" class="text-base-content/50">No matching deployments.</td></tr>
            {/each}
          </tbody>
        </DataTable>
      {/if}
    </Panel>

    <Panel title="Contract documentation" eyebrow="Catalog">
      <DataTable>
        <thead><tr><th>Contract</th><th>Kind</th><th>Digest</th><th>Docs</th></tr></thead>
        <tbody>
          {#each catalogContracts as contract (contract.digest)}
            <tr>
              <td class="trellis-identifier font-medium">{contract.id}</td>
              <td>{contractKind(contract)}</td>
              <td class="trellis-identifier text-base-content/60">{contract.digest}</td>
              <td><a class="btn btn-ghost btn-xs" href={resolve("/(app)/admin/services/contracts/[digest]", { digest: contract.digest })}>Open docs</a></td>
            </tr>
          {:else}
            <tr><td colspan="4" class="text-base-content/50">No catalog contracts available.</td></tr>
          {/each}
        </tbody>
      </DataTable>
    </Panel>
  {/if}
</section>
