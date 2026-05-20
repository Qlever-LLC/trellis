<script lang="ts">
  import { isErr, type AsyncResult, type BaseError } from "@qlever-llc/result";
  import type { AuthEnvelopesGetResponse, DeploymentEnvelope } from "@qlever-llc/trellis/auth";
  import { base } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { boundaryCounts, expansionRequestRows, livenessRows, serviceRuntimeDeployments, deviceRuntimeDeployments } from "$lib/envelope_console";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { getTrellis } from "../../../../lib/trellis";

  type ServiceDeployment = {
    kind: "service";
    deploymentId: string;
    namespaces: string[];
    disabled: boolean;
  };
  type DeviceDeployment = {
    kind: "device";
    deploymentId: string;
    disabled: boolean;
    reviewMode?: "none" | "required";
  };
  type ServiceInstance = {
    instanceId: string;
    deploymentId: string;
    instanceKey: string;
    disabled: boolean;
    currentContractId?: string;
    currentContractDigest?: string;
    capabilities: string[];
    resourceBindings?: {
      kv?: Record<string, { bucket: string }>;
      store?: Record<string, { name: string }>;
    };
    createdAt: string;
  };
  type DeviceInstance = {
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    metadata?: Record<string, string>;
    state: "registered" | "activated" | "revoked" | "disabled";
    currentContractId?: string;
    currentContractDigest?: string;
    createdAt: string;
    activatedAt: string | null;
    revokedAt: string | null;
  };
  type DeviceActivation = {
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  };
  type DeviceReview = {
    reviewId: string;
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    state: "pending" | "approved" | "rejected";
    requestedAt: string;
    decidedAt: string | null;
    reason?: string;
  };
  type ExpansionRequest = Parameters<typeof expansionRequestRows>[0][number];
  type DetailResponse = AuthEnvelopesGetResponse;
  type DeploymentKind = "service" | "device";
  type KindFilter = "all" | DeploymentKind;
  type StatusFilter = "all" | "active" | "disabled";
  type DetailTab = "overview" | "permissions" | "requests";
  type StatusVariant = "healthy" | "degraded" | "unhealthy" | "offline";

  type PageResponse<T> = {
    entries: T[];
  };

  type AuthorityRpcClient = {
    request(subject: "Auth.Deployments.List", input: { kind: "service"; limit: number; offset?: number }): AsyncResult<PageResponse<ServiceDeployment>, BaseError>;
    request(subject: "Auth.Deployments.List", input: { kind: "device"; limit: number; offset?: number }): AsyncResult<PageResponse<DeviceDeployment>, BaseError>;
    request(subject: "Auth.ServiceInstances.List", input: { limit: number; offset?: number }): AsyncResult<PageResponse<ServiceInstance>, BaseError>;
    request(subject: "Auth.Devices.List", input: { limit: number; offset?: number }): AsyncResult<PageResponse<DeviceInstance>, BaseError>;
    request(subject: "Auth.DeviceUserAuthorities.List", input: { limit: number; offset?: number }): AsyncResult<PageResponse<DeviceActivation>, BaseError>;
    request(subject: "Auth.DeviceUserAuthorities.Reviews.List", input: { state?: DeviceReview["state"]; limit: number; offset?: number }): AsyncResult<PageResponse<DeviceReview>, BaseError>;
    request(subject: "Auth.Envelopes.List", input: { limit: number; offset?: number }): AsyncResult<{ entries: DeploymentEnvelope[] }, BaseError>;
    request(subject: "Auth.Envelopes.Get", input: { deploymentId: string }): AsyncResult<DetailResponse, BaseError>;
    request(subject: "Auth.EnvelopeExpansions.List", input: { state?: ExpansionRequest["state"]; limit: number; offset?: number }): AsyncResult<PageResponse<ExpansionRequest>, BaseError>;
  };

  type DeploymentView = {
    key: string;
    kind: DeploymentKind;
    deploymentId: string;
    disabled: boolean;
    activeInstanceCount: number;
    totalInstanceCount: number;
    statusLabel: string;
    statusVariant: StatusVariant;
    searchText: string;
  };

  type DeploymentStatus = {
    label: string;
    variant: StatusVariant;
  };

  type AuthorityRequest = {
    key: string;
    type: "Authority" | "Device activation";
    deploymentId: string;
    subjectId: string;
    requester: string;
    state: string;
    createdAt: string;
    pending: boolean;
    sortTime: number;
  };

  const trellis = getTrellis();
  const authorityRpc = trellis as AuthorityRpcClient;
  const detailTabs: DetailTab[] = ["overview", "permissions", "requests"];

  let loading = $state(true);
  let detailLoading = $state(false);
  let error = $state<string | null>(null);
  let detailError = $state<string | null>(null);

  let serviceDeployments = $state.raw<ServiceDeployment[]>([]);
  let serviceInstances = $state.raw<ServiceInstance[]>([]);
  let deviceDeployments = $state.raw<DeviceDeployment[]>([]);
  let deviceInstances = $state.raw<DeviceInstance[]>([]);
  let deviceActivations = $state.raw<DeviceActivation[]>([]);
  let deviceReviews = $state.raw<DeviceReview[]>([]);
  let authorities = $state.raw<DeploymentEnvelope[]>([]);
  let expansionRequests = $state.raw<ExpansionRequest[]>([]);
  let detail = $state<DetailResponse | null>(null);

  let search = $state("");
  let kindFilter = $state<KindFilter>("all");
  let statusFilter = $state<StatusFilter>("all");
  let selectedKey = $state("");
  let activeDetailTab = $state<DetailTab>("overview");

  const serviceDeploymentsById = $derived.by(() => new Map(serviceDeployments.map((deployment) => [deployment.deploymentId, deployment])));
  const deviceDeploymentsById = $derived.by(() => new Map(deviceDeployments.map((deployment) => [deployment.deploymentId, deployment])));
  const authoritiesById = $derived.by(() => new Map(authorities.map((authority) => [authority.deploymentId, authority])));

  const deploymentViews = $derived.by(() => {
    const services = serviceDeployments.map((deployment): DeploymentView => {
      const instances = serviceInstances.filter((instance) => instance.deploymentId === deployment.deploymentId);
      const activeInstances = instances.filter((instance) => !instance.disabled);
      const statusLabel = deployment.disabled ? "Disabled" : activeInstances.length > 0 ? "Active" : "No instances";
      return {
        key: deploymentKey("service", deployment.deploymentId),
        kind: "service",
        deploymentId: deployment.deploymentId,
        disabled: deployment.disabled,
        activeInstanceCount: activeInstances.length,
        totalInstanceCount: instances.length,
        statusLabel,
        statusVariant: statusVariantForDeployment(deployment.disabled, activeInstances.length),
        searchText: [
          "service",
          deployment.deploymentId,
          ...deployment.namespaces,
          ...instances.flatMap((instance) => [instance.instanceId, instance.instanceKey, instance.currentContractId ?? "", instance.currentContractDigest ?? ""]),
        ].join(" ").toLowerCase(),
      };
    });

    const devices = deviceDeployments.map((deployment): DeploymentView => {
      const instances = deviceInstances.filter((instance) => instance.deploymentId === deployment.deploymentId);
      const activeInstances = instances.filter((instance) => instance.state === "activated");
      const status = deviceDeploymentStatus(deployment.disabled, instances);
      return {
        key: deploymentKey("device", deployment.deploymentId),
        kind: "device",
        deploymentId: deployment.deploymentId,
        disabled: deployment.disabled,
        activeInstanceCount: activeInstances.length,
        totalInstanceCount: instances.length,
        statusLabel: status.label,
        statusVariant: status.variant,
        searchText: ["device", deployment.deploymentId, deployment.reviewMode ?? "", ...instances.flatMap((instance) => [instance.instanceId, instance.publicIdentityKey, ...Object.values(instance.metadata ?? {})])]
          .join(" ")
          .toLowerCase(),
      };
    });

    return [...services, ...devices].sort((left, right) => left.deploymentId.localeCompare(right.deploymentId) || left.kind.localeCompare(right.kind));
  });

  const filteredDeployments = $derived.by(() => {
    const term = search.trim().toLowerCase();
    return deploymentViews.filter((deployment) => {
      if (kindFilter !== "all" && deployment.kind !== kindFilter) return false;
      if (statusFilter === "active" && deployment.disabled) return false;
      if (statusFilter === "disabled" && !deployment.disabled) return false;
      if (term && !deployment.searchText.includes(term)) return false;
      return true;
    });
  });

  const selectedDeployment = $derived(deploymentViews.find((deployment) => deployment.key === selectedKey) ?? null);
  const selectedAuthority = $derived(selectedDeployment ? authoritiesById.get(selectedDeployment.deploymentId) ?? null : null);
  const selectedDetail = $derived(detail?.envelope.deploymentId === selectedDeployment?.deploymentId ? detail : null);
  const selectedBoundary = $derived(selectedDetail?.envelope.boundary ?? selectedAuthority?.boundary ?? null);
  const selectedCounts = $derived(selectedBoundary ? boundaryCounts(selectedBoundary) : null);
  const selectedServiceDeployment = $derived(selectedDeployment?.kind === "service" ? serviceDeploymentsById.get(selectedDeployment.deploymentId) ?? null : null);
  const selectedDeviceDeployment = $derived(selectedDeployment?.kind === "device" ? deviceDeploymentsById.get(selectedDeployment.deploymentId) ?? null : null);
  const selectedServiceInstances = $derived(selectedServiceDeployment ? serviceInstances.filter((instance) => instance.deploymentId === selectedServiceDeployment.deploymentId) : []);
  const selectedDeviceInstances = $derived(selectedDeviceDeployment ? deviceInstances.filter((instance) => instance.deploymentId === selectedDeviceDeployment.deploymentId) : []);
  const selectedDeviceActivations = $derived(selectedDeviceDeployment ? deviceActivations.filter((activation) => activation.deploymentId === selectedDeviceDeployment.deploymentId) : []);
  const selectedDeviceReviews = $derived(selectedDeviceDeployment ? deviceReviews.filter((review) => review.deploymentId === selectedDeviceDeployment.deploymentId) : []);
  const authorityDeployments = $derived(selectedDeployment?.kind === "service" ? serviceRuntimeDeployments(selectedServiceInstances) : deviceRuntimeDeployments(selectedDeviceInstances));
  const liveRows = $derived(selectedBoundary && selectedDeployment ? livenessRows(selectedBoundary, authorityDeployments, selectedDeployment.deploymentId) : []);
  const selectedRequestRows = $derived.by(() => selectedDeployment ? authorityRequestsForDeployment(selectedDeployment.deploymentId) : []);
  const pendingRequests = $derived.by(() => allAuthorityRequests().filter((request) => request.pending).sort(compareAuthorityRequests));
  const totalDeployments = $derived(serviceDeployments.length + deviceDeployments.length);
  const disabledDeployments = $derived(deploymentViews.filter((deployment) => deployment.disabled).length);
  const grantOverrideCount = $derived(selectedDetail?.grantOverrides.length ?? 0);

  function deploymentKey(kind: DeploymentKind, deploymentId: string): string {
    return `${kind}:${deploymentId}`;
  }

  function tabPanelId(tab: DetailTab): string {
    return `authority-${tab}-panel`;
  }

  function tabButtonId(tab: DetailTab): string {
    return `authority-${tab}-tab`;
  }

  function deploymentHref(deployment: DeploymentView): string {
    const route = deployment.kind === "service" ? "/admin/services" : "/admin/devices";
    return `${base}${route}?deployment=${encodeURIComponent(deployment.deploymentId)}`;
  }

  function selectDetailTab(tab: DetailTab): void {
    activeDetailTab = tab;
    document.getElementById(tabButtonId(tab))?.focus();
  }

  function handleTabKeydown(event: KeyboardEvent, tab: DetailTab): void {
    const index = detailTabs.indexOf(tab);
    if (index === -1) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectDetailTab(detailTabs[(index + 1) % detailTabs.length]);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectDetailTab(detailTabs[(index - 1 + detailTabs.length) % detailTabs.length]);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectDetailTab(detailTabs[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      selectDetailTab(detailTabs[detailTabs.length - 1]);
    }
  }

  function statusVariantForDeployment(disabled: boolean, activeInstanceCount: number): StatusVariant {
    if (disabled) return "offline";
    if (activeInstanceCount > 0) return "healthy";
    return "offline";
  }

  function deviceDeploymentStatus(disabled: boolean, instances: DeviceInstance[]): DeploymentStatus {
    if (disabled) return { label: "Disabled", variant: "offline" };
    if (instances.some((instance) => instance.state === "activated")) return { label: "Active", variant: "healthy" };
    if (instances.some((instance) => instance.state === "registered")) return { label: "Registered", variant: "degraded" };
    if (instances.some((instance) => instance.state === "revoked")) return { label: "Revoked", variant: "unhealthy" };
    return { label: "No instances", variant: "offline" };
  }

  function statusForRequest(state: string): StatusVariant {
    if (state === "approved" || state === "activated") return "healthy";
    if (state === "pending") return "degraded";
    if (state === "rejected" || state === "revoked") return "unhealthy";
    return "offline";
  }

  function formatAge(value: string): string {
    const created = Date.parse(value);
    if (!Number.isFinite(created)) return formatDate(value);
    const seconds = Math.max(0, Math.floor((Date.now() - created) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function formatRequester(request: ExpansionRequest): string {
    if (typeof request.requestedBy === "string") return request.requestedBy;
    return request.requestedByKind;
  }

  function allAuthorityRequests(): AuthorityRequest[] {
    const authorityRequests = expansionRequests.map((request): AuthorityRequest => ({
      key: `authority:${request.requestId}`,
      type: "Authority",
      deploymentId: request.deploymentId,
      subjectId: request.requestId,
      requester: formatRequester(request),
      state: request.state,
      createdAt: request.createdAt,
      pending: request.state === "pending",
      sortTime: Date.parse(request.createdAt),
    }));
    const activationRequests = deviceReviews.map((review): AuthorityRequest => ({
      key: `device:${review.reviewId}`,
      type: "Device activation",
      deploymentId: review.deploymentId,
      subjectId: review.reviewId,
      requester: review.instanceId,
      state: review.state,
      createdAt: review.requestedAt,
      pending: review.state === "pending",
      sortTime: Date.parse(review.requestedAt),
    }));
    return [...authorityRequests, ...activationRequests];
  }

  function authorityRequestsForDeployment(deploymentId: string): AuthorityRequest[] {
    return allAuthorityRequests().filter((request) => request.deploymentId === deploymentId).sort(compareAuthorityRequests);
  }

  function compareAuthorityRequests(left: AuthorityRequest, right: AuthorityRequest): number {
    if (left.pending !== right.pending) return left.pending ? -1 : 1;
    return right.sortTime - left.sortTime || left.subjectId.localeCompare(right.subjectId);
  }

  function syncSelectedDeployment() {
    const requestedDeploymentId = page.url.searchParams.get("deployment");
    if (requestedDeploymentId) {
      const requestedDeployment = deploymentViews.find((deployment) => deployment.deploymentId === requestedDeploymentId);
      if (requestedDeployment) {
        selectedKey = requestedDeployment.key;
        return;
      }
    }

    if (deploymentViews.some((deployment) => deployment.key === selectedKey)) return;
    selectedKey = deploymentViews[0]?.key ?? "";
  }

  async function selectDeployment(deployment: DeploymentView, tab: DetailTab = activeDetailTab) {
    if (selectedKey !== deployment.key) detail = null;
    selectedKey = deployment.key;
    activeDetailTab = tab;
    await loadAuthorityDetail(deployment.deploymentId);
  }

  async function selectRequest(request: AuthorityRequest): Promise<void> {
    const deployment = deploymentViews.find((entry) => entry.deploymentId === request.deploymentId);
    if (deployment) await selectDeployment(deployment, "requests");
  }

  async function loadAuthorityDetail(deploymentId: string) {
    detailLoading = true;
    detailError = null;
    try {
      const response = await authorityRpc.request("Auth.Envelopes.Get", { deploymentId }).take();
      if (isErr(response)) {
        detailError = errorMessage(response);
        detail = null;
        return;
      }
      if (selectedDeployment?.deploymentId !== deploymentId) return;
      detail = response;
    } catch (e) {
      detailError = errorMessage(e);
      detail = null;
    } finally {
      detailLoading = false;
    }
  }

  async function load() {
    loading = true;
    error = null;
    detailError = null;
    try {
      const [
        serviceDeploymentsResponse,
        serviceInstancesResponse,
        deviceDeploymentsResponse,
        deviceInstancesResponse,
        deviceActivationsResponse,
        deviceReviewsResponse,
        authoritiesResponse,
        expansionRequestsResponse,
      ] = await Promise.all([
        authorityRpc.request("Auth.Deployments.List", { kind: "service", limit: 500, offset: 0 }).take(),
        authorityRpc.request("Auth.ServiceInstances.List", { limit: 500, offset: 0 }).take(),
        authorityRpc.request("Auth.Deployments.List", { kind: "device", limit: 500, offset: 0 }).take(),
        authorityRpc.request("Auth.Devices.List", { limit: 500, offset: 0 }).take(),
        authorityRpc.request("Auth.DeviceUserAuthorities.List", { limit: 500, offset: 0 }).take(),
        authorityRpc.request("Auth.DeviceUserAuthorities.Reviews.List", { state: "pending", limit: 500, offset: 0 }).take(),
        authorityRpc.request("Auth.Envelopes.List", { limit: 500, offset: 0 }).take(),
        authorityRpc.request("Auth.EnvelopeExpansions.List", { state: "pending", limit: 500, offset: 0 }).take(),
      ]);

      if (isErr(serviceDeploymentsResponse)) { error = errorMessage(serviceDeploymentsResponse); return; }
      if (isErr(serviceInstancesResponse)) { error = errorMessage(serviceInstancesResponse); return; }
      if (isErr(deviceDeploymentsResponse)) { error = errorMessage(deviceDeploymentsResponse); return; }
      if (isErr(deviceInstancesResponse)) { error = errorMessage(deviceInstancesResponse); return; }
      if (isErr(deviceActivationsResponse)) { error = errorMessage(deviceActivationsResponse); return; }
      if (isErr(deviceReviewsResponse)) { error = errorMessage(deviceReviewsResponse); return; }
      if (isErr(authoritiesResponse)) { error = errorMessage(authoritiesResponse); return; }
      if (isErr(expansionRequestsResponse)) { error = errorMessage(expansionRequestsResponse); return; }

      serviceDeployments = (serviceDeploymentsResponse.entries ?? []).filter((deployment): deployment is ServiceDeployment => deployment.kind === "service");
      serviceInstances = serviceInstancesResponse.entries ?? [];
      deviceDeployments = (deviceDeploymentsResponse.entries ?? []).filter((deployment): deployment is DeviceDeployment => deployment.kind === "device");
      deviceInstances = deviceInstancesResponse.entries ?? [];
      deviceActivations = deviceActivationsResponse.entries ?? [];
      deviceReviews = deviceReviewsResponse.entries ?? [];
      authorities = authoritiesResponse.entries ?? [];
      expansionRequests = expansionRequestsResponse.entries ?? [];
      syncSelectedDeployment();
      if (selectedDeployment) await loadAuthorityDetail(selectedDeployment.deploymentId);
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

<svelte:head>
  <title>Authority</title>
</svelte:head>

<section class="space-y-4">
  <PageToolbar title="Authority" description="Cross-kind authority and request review for service and device deployments.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading authority" /></Panel>
  {:else}
    <Panel title="Pending requests" eyebrow={`${pendingRequests.length} authority/device`} class="min-w-0">
      {#if pendingRequests.length === 0}
        <EmptyState title="No pending authority requests" description="Authority expansion and device activation review requests appear here when an operator decision is required." />
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm trellis-table min-w-[820px] table-fixed">
            <colgroup><col class="w-[16%]" /><col class="w-[22%]" /><col class="w-[22%]" /><col class="w-[18%]" /><col class="w-[12%]" /><col class="w-[10%]" /></colgroup>
            <thead><tr><th>Type</th><th>Deployment</th><th>Subject / request</th><th>Requester / instance</th><th>Age / created</th><th>Next action</th></tr></thead>
            <tbody>
              {#each pendingRequests as request (request.key)}
                <tr>
                  <td><span class="badge badge-outline badge-xs">{request.type}</span></td>
                  <td class="trellis-identifier truncate">{request.deploymentId}</td>
                  <td class="trellis-identifier truncate">{request.subjectId}</td>
                  <td class="trellis-identifier truncate text-base-content/60">{request.requester}</td>
                  <td><div class="whitespace-nowrap">{formatAge(request.createdAt)}</div><div class="text-xs text-base-content/50">{formatDate(request.createdAt)}</div></td>
                  <td><button class="btn btn-ghost btn-xs" onclick={() => selectRequest(request)}>Review</button></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Panel>

    <div class="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
      <Panel title="Deployment list" eyebrow={`${filteredDeployments.length} of ${totalDeployments} shown`} class="min-w-0">
        <div class="mb-3 space-y-3">
          <label class="input input-bordered input-sm flex items-center gap-2">
            <Icon name="search" size={14} class="text-base-content/50" />
            <input bind:value={search} class="grow" placeholder="Search authority by deployment, instance, or contract" />
          </label>

          <div class="grid grid-cols-2 gap-2">
            <label class="form-control gap-1">
              <span class="label-text text-xs">Kind</span>
              <select class="select select-bordered select-sm" bind:value={kindFilter}>
                <option value="all">All</option>
                <option value="service">Service</option>
                <option value="device">Device</option>
              </select>
            </label>
            <label class="form-control gap-1">
              <span class="label-text text-xs">Status</span>
              <select class="select select-bordered select-sm" bind:value={statusFilter}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
          </div>
        </div>

        {#if totalDeployments === 0}
          <EmptyState title="No authority deployments" description="Service and device deployments appear here when they can receive authority or review requests." />
        {:else if filteredDeployments.length === 0}
          <EmptyState title="No matches" description="Adjust search, kind, or status filters." />
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-sm trellis-table">
              <thead><tr><th>Deployment</th><th>Kind</th><th>Subjects</th><th>Status</th></tr></thead>
              <tbody>
                {#each filteredDeployments as deployment (deployment.key)}
                  <tr class={{ "bg-base-200/60": selectedKey === deployment.key }}>
                    <td>
                      <button class="trellis-identifier text-left font-medium hover:underline" onclick={() => selectDeployment(deployment)}>
                        {deployment.deploymentId}
                      </button>
                    </td>
                    <td><span class="badge badge-outline badge-xs capitalize">{deployment.kind}</span></td>
                    <td class="text-base-content/60">{deployment.activeInstanceCount}/{deployment.totalInstanceCount}</td>
                    <td><StatusBadge label={deployment.statusLabel} status={deployment.statusVariant} /></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        {#snippet footer()}
          <span>{disabledDeployments} disabled / archived</span>
        {/snippet}
      </Panel>

      <div class="min-w-0 space-y-4">
        {#if totalDeployments === 0}
          <Panel><EmptyState title="No authority detail" description="The authority detail view appears after deployments exist." /></Panel>
        {:else if !selectedDeployment}
          <Panel><EmptyState title="Select authority" description="Choose a service or device deployment from the authority list." /></Panel>
        {:else}
          <Panel title="Authority detail" eyebrow={`${selectedDeployment.kind} review surface`} class="min-w-0">
            {#snippet actions()}
              <a class="btn btn-outline btn-sm" href={deploymentHref(selectedDeployment)}>
                {selectedDeployment.kind === "service" ? "Service deployments" : "Device deployments"}
              </a>
            {/snippet}

            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="flex min-w-0 items-start gap-3">
                <div class="rounded-box bg-base-200 p-2.5 text-base-content/70">
                  <Icon name={selectedDeployment.kind === "service" ? "server" : "cpu"} size={22} />
                </div>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="trellis-identifier truncate text-lg font-semibold">{selectedDeployment.deploymentId}</h2>
                    <span class="badge badge-outline badge-sm capitalize">{selectedDeployment.kind}</span>
                    <StatusBadge label={selectedDeployment.statusLabel} status={selectedDeployment.statusVariant} />
                  </div>
                  <p class="mt-1 text-sm text-base-content/60">Review authority boundaries, permission rows, and pending cross-kind requests. Runtime management lives in the linked deployment pages.</p>
                </div>
              </div>
            </div>

            <div class="tabs tabs-bordered mt-4" role="tablist" aria-label="Authority detail sections">
              {#each detailTabs as tab (tab)}
                <button
                  id={tabButtonId(tab)}
                  class={["tab capitalize", activeDetailTab === tab && "tab-active"]}
                  type="button"
                  role="tab"
                  aria-selected={activeDetailTab === tab}
                  aria-controls={tabPanelId(tab)}
                  tabindex={activeDetailTab === tab ? 0 : -1}
                  onclick={() => selectDetailTab(tab)}
                  onkeydown={(event) => handleTabKeydown(event, tab)}
                >{tab}</button>
              {/each}
            </div>

            {#if detailError}
              <div class="alert alert-warning mt-3 text-sm"><span>{detailError}</span></div>
            {/if}

            {#if detailLoading}
              <LoadingState label="Loading authority detail" class="min-h-32" />
            {:else if activeDetailTab === "overview"}
              <div id={tabPanelId("overview")} class="mt-4 space-y-4" role="tabpanel" aria-labelledby={tabButtonId("overview")} tabindex="0">
                <dl class="grid gap-px overflow-hidden rounded-box border border-base-300 bg-base-300 text-sm sm:grid-cols-2 xl:grid-cols-4">
                  <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Kind</dt><dd class="mt-1 font-medium capitalize">{selectedDeployment.kind}</dd></div>
                  <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Status</dt><dd class="mt-1"><StatusBadge label={selectedDeployment.statusLabel} status={selectedDeployment.statusVariant} /></dd></div>
                  <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Subjects</dt><dd class="mt-1 font-medium">{selectedDeployment.activeInstanceCount}/{selectedDeployment.totalInstanceCount} active</dd></div>
                  <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Pending requests</dt><dd class="mt-1 font-medium">{selectedRequestRows.filter((request) => request.pending).length}</dd></div>
                </dl>

                {#if selectedDeviceDeployment}
                  <dl class="divide-y divide-base-300 rounded-box border border-base-300 text-sm">
                    <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Review mode</dt><dd class="font-medium">{selectedDeviceDeployment.reviewMode ?? "none"}</dd></div>
                    <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Activations</dt><dd class="font-medium">{selectedDeviceActivations.length}</dd></div>
                    <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Reviews</dt><dd class="font-medium">{selectedDeviceReviews.length}</dd></div>
                  </dl>
                {/if}

                <div class="rounded-box border border-base-300 p-3 text-sm text-base-content/65">
                  Need runtime details? Open the linked {selectedDeployment.kind === "service" ? "service deployments" : "device deployments"} page for instances, health, and resource management.
                </div>
              </div>
            {:else if activeDetailTab === "permissions"}
              <div id={tabPanelId("permissions")} class="mt-4 space-y-4" role="tabpanel" aria-labelledby={tabButtonId("permissions")} tabindex="0">
                {#if selectedCounts && selectedBoundary}
                  <dl class="grid gap-px overflow-hidden rounded-box border border-base-300 bg-base-300 text-sm sm:grid-cols-2 xl:grid-cols-5">
                    <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Contracts</dt><dd class="mt-1 font-medium">{selectedCounts.requiredContracts} req / {selectedCounts.optionalContracts} opt</dd></div>
                    <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Surfaces</dt><dd class="mt-1 font-medium">{selectedCounts.requiredSurfaces} req / {selectedCounts.optionalSurfaces} opt</dd></div>
                    <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Capabilities</dt><dd class="mt-1 font-medium">{selectedCounts.capabilities}</dd></div>
                    <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Resources</dt><dd class="mt-1 font-medium">{selectedCounts.requiredResources} req / {selectedCounts.optionalResources} opt</dd></div>
                    <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Grant overrides</dt><dd class="mt-1 font-medium">{grantOverrideCount}</dd></div>
                  </dl>

                  {#if liveRows.length === 0}
                    <EmptyState title="No authority permissions" description="Authority boundary rows appear when contracts contribute API, event, operation, feed, capability, or resource requirements." class="py-4" />
                  {:else}
                    <div class="overflow-x-auto">
                      <table class="table table-xs trellis-table">
                        <thead><tr><th>Surface</th><th>Kind</th><th>Action</th><th>Availability</th><th>Runtime</th></tr></thead>
                        <tbody>
                          {#each liveRows as row (row.id)}
                            <tr>
                              <td><div class="trellis-identifier">{row.surface}</div><div class="text-xs text-base-content/50">{row.contractId}</div></td>
                              <td>{row.kind}</td>
                              <td>{row.action}</td>
                              <td><span class="badge badge-outline badge-xs">{row.availability}</span></td>
                              <td><span class={["badge badge-xs", row.runtime === "live" ? "badge-success" : row.runtime === "disabled" ? "badge-neutral" : "badge-warning"]}>{row.runtime}</span></td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  {/if}
                {:else}
                  <EmptyState title="No authority boundary" description="Authority permissions are not available for this deployment yet." />
                {/if}
              </div>
            {:else if activeDetailTab === "requests"}
              <div id={tabPanelId("requests")} class="mt-4 space-y-3" role="tabpanel" aria-labelledby={tabButtonId("requests")} tabindex="0">
                {#if selectedRequestRows.length === 0}
                  <EmptyState title="No authority requests" description="Authority expansion requests and device activation reviews for this deployment appear here." />
                {:else}
                  <div class="overflow-x-auto">
                    <table class="table table-sm trellis-table min-w-[760px] table-fixed">
                      <colgroup><col class="w-[18%]" /><col class="w-[24%]" /><col class="w-[15%]" /><col class="w-[21%]" /><col class="w-[22%]" /></colgroup>
                      <thead><tr><th>Type</th><th>Request</th><th>State</th><th>Requester / instance</th><th>Created</th></tr></thead>
                      <tbody>
                        {#each selectedRequestRows as request (request.key)}
                          <tr>
                            <td><span class="badge badge-outline badge-xs">{request.type}</span></td>
                            <td class="trellis-identifier truncate">{request.subjectId}</td>
                            <td><StatusBadge label={request.state} status={statusForRequest(request.state)} /></td>
                            <td class="trellis-identifier truncate text-base-content/60">{request.requester}</td>
                            <td><span>{formatDate(request.createdAt)}</span><span class="ml-2 text-xs text-base-content/50">{formatAge(request.createdAt)}</span></td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                {/if}
              </div>
            {/if}
          </Panel>
        {/if}
      </div>
    </div>
  {/if}
</section>
