<script lang="ts">
  import { isErr, type AsyncResult, type BaseError } from "@qlever-llc/result";
  import type {
    AuthEnvelopesGetResponse,
    DeploymentEnvelope,
  } from "@qlever-llc/trellis/auth";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import {
    boundaryCounts,
    expansionRequestRows,
    formatBindingTarget,
    livenessRows,
    serviceRuntimeDeployments,
    deviceRuntimeDeployments,
  } from "$lib/envelope_console";
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
  type Deployment = ServiceDeployment | DeviceDeployment;
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
  type DetailTab = "overview" | "permissions" | "requests" | "instances" | "health" | "resources";
  type StatusVariant = "healthy" | "degraded" | "unhealthy" | "offline";

  type PageResponse<T> = {
    entries: T[];
  };

  type DeploymentRpcClient = {
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

  type RuntimeRequest = {
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
  const deploymentRpc = trellis as DeploymentRpcClient;
  const understoodMetadataKeys = ["name", "serialNumber", "modelNumber"] as const;
  const detailTabs: DetailTab[] = ["overview", "permissions", "requests", "instances", "health", "resources"];

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
  let selectedServiceInstanceId = $state("");
  let activeDetailTab = $state<DetailTab>("overview");

  const serviceDeploymentsById = $derived.by(() => new Map(serviceDeployments.map((deployment) => [deployment.deploymentId, deployment])));
  const deviceDeploymentsById = $derived.by(() => new Map(deviceDeployments.map((deployment) => [deployment.deploymentId, deployment])));
  const deviceInstancesById = $derived.by(() => new Map(deviceInstances.map((instance) => [instance.instanceId, instance])));
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
        searchText: [
          "device",
          deployment.deploymentId,
          deployment.reviewMode ?? "",
          ...instances.flatMap((instance) => [instance.instanceId, instance.publicIdentityKey, ...Object.values(instance.metadata ?? {})]),
        ].join(" ").toLowerCase(),
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
  const selectedServiceInstance = $derived.by(() => selectedServiceInstances.find((instance) => instance.instanceId === selectedServiceInstanceId) ?? selectedServiceInstances[0] ?? null);
  const selectedDeviceInstances = $derived(selectedDeviceDeployment ? deviceInstances.filter((instance) => instance.deploymentId === selectedDeviceDeployment.deploymentId) : []);
  const selectedDeviceActivations = $derived(selectedDeviceDeployment ? deviceActivations.filter((activation) => activation.deploymentId === selectedDeviceDeployment.deploymentId) : []);
  const selectedDeviceReviews = $derived(selectedDeviceDeployment ? deviceReviews.filter((review) => review.deploymentId === selectedDeviceDeployment.deploymentId) : []);
  const runtimeDeployments = $derived(selectedDeployment?.kind === "service" ? serviceRuntimeDeployments(selectedServiceInstances) : deviceRuntimeDeployments(selectedDeviceInstances));
  const liveRows = $derived(selectedBoundary && selectedDeployment ? livenessRows(selectedBoundary, runtimeDeployments, selectedDeployment.deploymentId) : []);
  const selectedRequestRows = $derived.by(() => selectedDeployment ? runtimeRequestsForDeployment(selectedDeployment.deploymentId) : []);
  const pendingRequests = $derived.by(() => allRuntimeRequests().filter((request) => request.pending).sort(compareRuntimeRequests));
  const totalDeployments = $derived(serviceDeployments.length + deviceDeployments.length);
  const disabledDeployments = $derived(deploymentViews.filter((deployment) => deployment.disabled).length);
  const grantOverrideCount = $derived(selectedDetail?.grantOverrides.length ?? 0);

  function deploymentKey(kind: DeploymentKind, deploymentId: string): string {
    return `${kind}:${deploymentId}`;
  }

  function tabPanelId(tab: DetailTab): string {
    return `deployment-${tab}-panel`;
  }

  function tabButtonId(tab: DetailTab): string {
    return `deployment-${tab}-tab`;
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

  function statusForInstance(disabled: boolean): StatusVariant {
    return disabled ? "offline" : "healthy";
  }

  function statusForDeviceState(state: DeviceInstance["state"]): StatusVariant {
    if (state === "activated") return "healthy";
    if (state === "registered") return "degraded";
    if (state === "revoked") return "unhealthy";
    return "offline";
  }

  function statusForRequest(state: string): StatusVariant {
    if (state === "approved" || state === "activated") return "healthy";
    if (state === "pending") return "degraded";
    if (state === "rejected" || state === "revoked") return "unhealthy";
    return "offline";
  }

  function formatMaybeDate(value?: string | null): string {
    return value ? formatDate(value) : "—";
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

  function deviceMetadataValue(instanceId: string, key: (typeof understoodMetadataKeys)[number]): string {
    return deviceInstancesById.get(instanceId)?.metadata?.[key] ?? "—";
  }

  function metadataEntries(instance: DeviceInstance): Array<[string, string]> {
    return Object.entries(instance.metadata ?? {}).filter(
      (entry): entry is [string, string] => !understoodMetadataKeys.some((metadataKey) => metadataKey === entry[0]) && typeof entry[1] === "string",
    );
  }

  function hasResourceBindings(instance: ServiceInstance): boolean {
    return Object.keys(instance.resourceBindings?.kv ?? {}).length > 0 || Object.keys(instance.resourceBindings?.store ?? {}).length > 0;
  }

  function allRuntimeRequests(): RuntimeRequest[] {
    const authorityRequests = expansionRequests.map((request): RuntimeRequest => ({
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
    const activationRequests = deviceReviews.map((review): RuntimeRequest => ({
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

  function runtimeRequestsForDeployment(deploymentId: string): RuntimeRequest[] {
    return allRuntimeRequests().filter((request) => request.deploymentId === deploymentId).sort(compareRuntimeRequests);
  }

  function compareRuntimeRequests(left: RuntimeRequest, right: RuntimeRequest): number {
    if (left.pending !== right.pending) return left.pending ? -1 : 1;
    return right.sortTime - left.sortTime || left.subjectId.localeCompare(right.subjectId);
  }

  function syncSelectedDeployment() {
    const requestedDeploymentId = page.url.searchParams.get("deployment");
    if (requestedDeploymentId) {
      const requestedDeployment = deploymentViews.find((deployment) => deployment.deploymentId === requestedDeploymentId);
      if (requestedDeployment) {
        if (selectedKey !== requestedDeployment.key) selectedServiceInstanceId = "";
        selectedKey = requestedDeployment.key;
        return;
      }
    }

    if (deploymentViews.some((deployment) => deployment.key === selectedKey)) return;
    selectedKey = deploymentViews[0]?.key ?? "";
    selectedServiceInstanceId = "";
  }

  async function selectDeployment(deployment: DeploymentView, tab: DetailTab = activeDetailTab) {
    if (selectedKey !== deployment.key) {
      selectedServiceInstanceId = "";
      detail = null;
    }
    selectedKey = deployment.key;
    activeDetailTab = tab;
    await loadAuthorityDetail(deployment.deploymentId);
  }

  async function selectRequest(request: RuntimeRequest): Promise<void> {
    const deployment = deploymentViews.find((entry) => entry.deploymentId === request.deploymentId);
    if (deployment) await selectDeployment(deployment, "requests");
  }

  function selectServiceInstance(instance: ServiceInstance) {
    selectedServiceInstanceId = instance.instanceId;
  }

  async function loadAuthorityDetail(deploymentId: string) {
    detailLoading = true;
    detailError = null;
    try {
      const response = await deploymentRpc.request("Auth.Envelopes.Get", { deploymentId }).take();
      if (isErr(response)) { detailError = errorMessage(response); detail = null; return; }
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
        deploymentRpc.request("Auth.Deployments.List", { kind: "service", limit: 500, offset: 0 }).take(),
        deploymentRpc.request("Auth.ServiceInstances.List", { limit: 500, offset: 0 }).take(),
        deploymentRpc.request("Auth.Deployments.List", { kind: "device", limit: 500, offset: 0 }).take(),
        deploymentRpc.request("Auth.Devices.List", { limit: 500, offset: 0 }).take(),
        deploymentRpc.request("Auth.DeviceUserAuthorities.List", { limit: 500, offset: 0 }).take(),
        deploymentRpc.request("Auth.DeviceUserAuthorities.Reviews.List", { state: "pending", limit: 500, offset: 0 }).take(),
        deploymentRpc.request("Auth.Envelopes.List", { limit: 500, offset: 0 }).take(),
        deploymentRpc.request("Auth.EnvelopeExpansions.List", { state: "pending", limit: 500, offset: 0 }).take(),
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
  <title>Deployments</title>
</svelte:head>

<section class="space-y-4">
  <PageToolbar title="Deployments" description="Canonical service and device deployment control surface.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading deployments" /></Panel>
  {:else}
    <Panel title="Pending requests" eyebrow={`${pendingRequests.length} runtime/deployment`} class="min-w-0">
      {#if pendingRequests.length === 0}
        <EmptyState title="No pending runtime requests" description="Authority expansion and device activation review requests appear here when deployments need an operator decision." />
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
            <input bind:value={search} class="grow" placeholder="Search deployments and instances" />
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
          <EmptyState title="No deployments" description="Create a service or device deployment to populate this scan." />
        {:else if filteredDeployments.length === 0}
          <EmptyState title="No matches" description="Adjust search, kind, or status filters." />
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-sm trellis-table">
              <thead><tr><th>Deployment</th><th>Kind</th><th>Instances</th><th>Status</th></tr></thead>
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
          <Panel><EmptyState title="No deployment detail" description="The deployment detail view appears after deployments exist." /></Panel>
        {:else if !selectedDeployment}
          <Panel><EmptyState title="Select a deployment" description="Choose a service or device deployment from the list." /></Panel>
        {:else}
          <Panel title="Deployment detail" eyebrow={`${selectedDeployment.kind} control surface`} class="min-w-0">
            {#snippet actions()}
              {#if selectedDeployment.kind === "service"}
                <a class="btn btn-outline btn-sm" href={resolve(`/admin/services?deployment=${encodeURIComponent(selectedDeployment.deploymentId)}`)}>Service runtime</a>
              {/if}
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
                  <p class="mt-1 text-sm text-base-content/60">Manage deployment permissions, requests, runtime instances, health, and resources in one place.</p>
                </div>
              </div>
            </div>

            <div class="tabs tabs-bordered mt-4" role="tablist" aria-label="Deployment detail sections">
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
              <LoadingState label="Loading deployment authority detail" class="min-h-32" />
            {:else if activeDetailTab === "overview"}
              <div id={tabPanelId("overview")} class="mt-4 space-y-4" role="tabpanel" aria-labelledby={tabButtonId("overview")} tabindex="0">
                <dl class="grid gap-px overflow-hidden rounded-box border border-base-300 bg-base-300 text-sm sm:grid-cols-2 xl:grid-cols-4">
                  <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Kind</dt><dd class="mt-1 font-medium capitalize">{selectedDeployment.kind}</dd></div>
                  <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Status</dt><dd class="mt-1"><StatusBadge label={selectedDeployment.statusLabel} status={selectedDeployment.statusVariant} /></dd></div>
                  <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Instances</dt><dd class="mt-1 font-medium">{selectedDeployment.activeInstanceCount}/{selectedDeployment.totalInstanceCount} active</dd></div>
                  <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Pending requests</dt><dd class="mt-1 font-medium">{selectedRequestRows.filter((request) => request.pending).length}</dd></div>
                </dl>

                {#if selectedDeviceDeployment}
                  <dl class="divide-y divide-base-300 rounded-box border border-base-300 text-sm">
                    <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Review mode</dt><dd class="font-medium">{selectedDeviceDeployment.reviewMode ?? "none"}</dd></div>
                    <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Activations</dt><dd class="font-medium">{selectedDeviceActivations.length}</dd></div>
                    <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Reviews</dt><dd class="font-medium">{selectedDeviceReviews.length}</dd></div>
                  </dl>
                {/if}
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
                    <EmptyState title="No deployment permissions" description="Authority boundary rows appear when contracts contribute API, event, operation, feed, capability, or resource requirements." class="py-4" />
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
                  <EmptyState title="No authority boundary" description="Deployment permissions are not available for this deployment yet." />
                {/if}
              </div>
            {:else if activeDetailTab === "requests"}
              <div id={tabPanelId("requests")} class="mt-4 space-y-3" role="tabpanel" aria-labelledby={tabButtonId("requests")} tabindex="0">
                {#if selectedRequestRows.length === 0}
                  <EmptyState title="No deployment requests" description="Authority expansion requests and device activation reviews for this deployment appear here." />
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
            {:else if activeDetailTab === "instances"}
              <div id={tabPanelId("instances")} class="mt-4" role="tabpanel" aria-labelledby={tabButtonId("instances")} tabindex="0">
                {#if selectedDeployment.kind === "service"}
                  {#if selectedServiceInstances.length === 0}
                    <EmptyState title="No service instances" description="No service runtime instances are associated with this deployment." class="py-4" />
                  {:else}
                    <div class="overflow-x-auto">
                      <table class="table table-sm trellis-table">
                        <thead><tr><th>Instance</th><th>Status</th><th>Contract</th><th>Created</th></tr></thead>
                        <tbody>
                          {#each selectedServiceInstances as instance (instance.instanceId)}
                            <tr class={{ "bg-base-200/60": selectedServiceInstance?.instanceId === instance.instanceId }}>
                              <td><button class="trellis-identifier max-w-48 truncate text-left font-medium hover:underline" onclick={() => selectServiceInstance(instance)}>{instance.instanceId}</button><div class="trellis-identifier text-xs text-base-content/60">{instance.instanceKey}</div></td>
                              <td><StatusBadge label={instance.disabled ? "Disabled" : "Active"} status={statusForInstance(instance.disabled)} /></td>
                              <td><div class="trellis-identifier text-base-content/70">{instance.currentContractId ?? "—"}</div><div class="trellis-identifier text-xs text-base-content/50">{instance.currentContractDigest ?? "—"}</div></td>
                              <td class="whitespace-nowrap text-base-content/60">{formatMaybeDate(instance.createdAt)}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  {/if}
                {:else if selectedDeviceDeployment}
                  {#if selectedDeviceInstances.length === 0}
                    <EmptyState title="No device instances" description="No device instances are associated with this deployment." class="py-4" />
                  {:else}
                    <div class="overflow-x-auto">
                      <table class="table table-sm trellis-table">
                        <thead><tr><th>Instance</th><th>Identity</th><th>Metadata</th><th>State</th><th>Created</th><th>Activated</th></tr></thead>
                        <tbody>
                          {#each selectedDeviceInstances as instance (`${instance.instanceId}:${instance.createdAt}:${instance.publicIdentityKey}`)}
                            <tr>
                              <td class="trellis-identifier font-medium">{instance.instanceId}</td>
                              <td class="trellis-identifier text-base-content/60">{instance.publicIdentityKey}</td>
                              <td class="text-xs text-base-content/60">
                                <div>Name: {instance.metadata?.name ?? "—"}</div>
                                <div>Serial: {instance.metadata?.serialNumber ?? "—"}</div>
                                <div>Model: {instance.metadata?.modelNumber ?? "—"}</div>
                                {#each metadataEntries(instance) as [key, value] (key)}
                                  <div><span class="font-medium text-base-content">{key}</span>=<span class="trellis-identifier">{value}</span></div>
                                {/each}
                              </td>
                              <td><StatusBadge label={instance.state} status={statusForDeviceState(instance.state)} /></td>
                              <td class="text-base-content/60">{formatDate(instance.createdAt)}</td>
                              <td class="text-base-content/60">{formatMaybeDate(instance.activatedAt)}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  {/if}
                {/if}
              </div>
            {:else if activeDetailTab === "health"}
              <div id={tabPanelId("health")} class="mt-4 space-y-3" role="tabpanel" aria-labelledby={tabButtonId("health")} tabindex="0">
                <dl class="divide-y divide-base-300 rounded-box border border-base-300 text-sm">
                  <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Deployment status</dt><dd><StatusBadge label={selectedDeployment.statusLabel} status={selectedDeployment.statusVariant} /></dd></div>
                  <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Lifecycle</dt><dd>{selectedDeployment.disabled ? "Disabled" : "Active"}</dd></div>
                  <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Runtime availability</dt><dd>{liveRows.filter((row) => row.runtime === "live").length} live / {liveRows.length} permission surfaces</dd></div>
                  <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Instances</dt><dd>{selectedDeployment.activeInstanceCount} active / {selectedDeployment.totalInstanceCount} total</dd></div>
                </dl>
              </div>
            {:else if activeDetailTab === "resources"}
              <div id={tabPanelId("resources")} class="mt-4 space-y-4 text-sm" role="tabpanel" aria-labelledby={tabButtonId("resources")} tabindex="0">
                {#if selectedServiceInstance}
                  <div>
                    <h3 class="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-base-content/50">Service resource bindings</h3>
                    <div class="trellis-token-list min-w-0 rounded-box border border-base-300 p-3">
                      {#each Object.entries(selectedServiceInstance.resourceBindings?.kv ?? {}) as [alias, binding] (alias)}
                        <span class="badge badge-outline badge-xs">kv:{alias} <span class="trellis-identifier ml-1 text-base-content/60">{binding.bucket}</span></span>
                      {/each}
                      {#each Object.entries(selectedServiceInstance.resourceBindings?.store ?? {}) as [alias, binding] (alias)}
                        <span class="badge badge-outline badge-xs">store:{alias} <span class="trellis-identifier ml-1 text-base-content/60">{binding.name}</span></span>
                      {/each}
                      {#if !hasResourceBindings(selectedServiceInstance)}
                        <span class="text-base-content/60">No service resource bindings.</span>
                      {/if}
                    </div>
                  </div>
                {/if}

                <div>
                  <h3 class="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-base-content/50">Deployment-owned resources</h3>
                  {#if selectedDetail?.resourceBindings.length === 0 || !selectedDetail}
                    <p class="rounded-box border border-base-300 p-3 text-base-content/55">No deployment-owned resource bindings loaded.</p>
                  {:else}
                    <div class="space-y-1">
                      {#each selectedDetail.resourceBindings as binding (`${binding.kind}:${binding.alias}`)}
                        <div class="flex items-center justify-between rounded-box border border-base-300 px-3 py-2">
                          <span><span class="badge badge-outline badge-xs">{binding.kind}</span> <span class="trellis-identifier">{binding.alias}</span></span>
                          <span class="text-xs text-base-content/55">{formatBindingTarget(binding)}</span>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>

                <div class="rounded-box border border-base-300 p-3 text-base-content/65">
                  Portal route: {selectedDetail?.portalRoute?.portalId ?? "No route"}{selectedDetail?.portalRoute?.entryUrl ? ` · ${selectedDetail.portalRoute.entryUrl}` : ""}
                </div>
              </div>
            {/if}
          </Panel>
        {/if}
      </div>
    </div>
  {/if}
</section>
