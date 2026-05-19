<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthDeviceUserAuthoritiesReviewsListOutput,
    AuthDeviceUserAuthoritiesListOutput,
    AuthDeploymentsListOutput,
    AuthDevicesListOutput,
    AuthServiceInstancesListOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { getTrellis } from "../../../../lib/trellis";

  type Deployment = AuthDeploymentsListOutput["deployments"][number];
  type ServiceDeployment = Extract<Deployment, { kind: "service" }>;
  type ServiceInstance = AuthServiceInstancesListOutput["instances"][number];
  type DeviceDeployment = Extract<Deployment, { kind: "device" }>;
  type DeviceInstance = AuthDevicesListOutput["instances"][number] & {
    metadata?: Record<string, string>;
  };
  type DeviceActivation = AuthDeviceUserAuthoritiesListOutput["activations"][number];
  type DeviceReview = AuthDeviceUserAuthoritiesReviewsListOutput["reviews"][number];
  type DeploymentKind = "service" | "device";
  type KindFilter = "all" | DeploymentKind;
  type StatusFilter = "all" | "active" | "disabled";
  type StatusVariant = "healthy" | "degraded" | "unhealthy" | "offline";

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

  const trellis = getTrellis();
  const understoodMetadataKeys = ["name", "serialNumber", "modelNumber"] as const;

  let loading = $state(true);
  let error = $state<string | null>(null);

  let serviceDeployments = $state.raw<ServiceDeployment[]>([]);
  let serviceInstances = $state.raw<ServiceInstance[]>([]);
  let deviceDeployments = $state.raw<DeviceDeployment[]>([]);
  let deviceInstances = $state.raw<DeviceInstance[]>([]);
  let deviceActivations = $state.raw<DeviceActivation[]>([]);
  let deviceReviews = $state.raw<DeviceReview[]>([]);

  let search = $state("");
  let kindFilter = $state<KindFilter>("all");
  let statusFilter = $state<StatusFilter>("all");
  let selectedKey = $state("");
  let selectedServiceInstanceId = $state("");

  const serviceDeploymentsById = $derived.by(() => new Map(serviceDeployments.map((deployment) => [deployment.deploymentId, deployment])));
  const deviceDeploymentsById = $derived.by(() => new Map(deviceDeployments.map((deployment) => [deployment.deploymentId, deployment])));
  const deviceInstancesById = $derived.by(() => new Map(deviceInstances.map((instance) => [instance.instanceId, instance])));

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
  const selectedServiceDeployment = $derived(selectedDeployment?.kind === "service" ? serviceDeploymentsById.get(selectedDeployment.deploymentId) ?? null : null);
  const selectedDeviceDeployment = $derived(selectedDeployment?.kind === "device" ? deviceDeploymentsById.get(selectedDeployment.deploymentId) ?? null : null);
  const selectedServiceInstances = $derived(selectedServiceDeployment ? serviceInstances.filter((instance) => instance.deploymentId === selectedServiceDeployment.deploymentId) : []);
  const selectedServiceInstance = $derived.by(() => selectedServiceInstances.find((instance) => instance.instanceId === selectedServiceInstanceId) ?? selectedServiceInstances[0] ?? null);
  const selectedDeviceInstances = $derived(selectedDeviceDeployment ? deviceInstances.filter((instance) => instance.deploymentId === selectedDeviceDeployment.deploymentId) : []);
  const selectedDeviceActivations = $derived(selectedDeviceDeployment ? deviceActivations.filter((activation) => activation.deploymentId === selectedDeviceDeployment.deploymentId) : []);
  const selectedDeviceReviews = $derived(selectedDeviceDeployment ? deviceReviews.filter((review) => review.deploymentId === selectedDeviceDeployment.deploymentId) : []);
  const totalDeployments = $derived(serviceDeployments.length + deviceDeployments.length);
  const disabledDeployments = $derived(deploymentViews.filter((deployment) => deployment.disabled).length);

  function deploymentKey(kind: DeploymentKind, deploymentId: string): string {
    return `${kind}:${deploymentId}`;
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

  function statusForActivation(state: DeviceActivation["state"]): StatusVariant {
    return state === "activated" ? "healthy" : "offline";
  }

  function statusForReview(state: DeviceReview["state"]): StatusVariant {
    if (state === "approved") return "healthy";
    if (state === "pending") return "degraded";
    if (state === "rejected") return "unhealthy";
    return "offline";
  }

  function formatMaybeDate(value?: string | null): string {
    return value ? formatDate(value) : "—";
  }

  function formatActivatedBy(actor: DeviceActivation["activatedBy"]): string {
    return actor ? `${actor.participantKind}:${actor.identity.provider}:${actor.identity.subject}` : "—";
  }

  function deviceMetadataValue(instanceId: string, key: (typeof understoodMetadataKeys)[number]): string {
    return deviceInstancesById.get(instanceId)?.metadata?.[key] ?? "—";
  }

  function metadataEntries(instance: DeviceInstance): Array<[string, string]> {
    return Object.entries(instance.metadata ?? {}).filter(([key]) => !understoodMetadataKeys.some((metadataKey) => metadataKey === key));
  }

  function hasResourceBindings(instance: ServiceInstance): boolean {
    return Object.keys(instance.resourceBindings?.kv ?? {}).length > 0 || Object.keys(instance.resourceBindings?.store ?? {}).length > 0;
  }

  function syncSelectedDeployment() {
    if (deploymentViews.some((deployment) => deployment.key === selectedKey)) return;
    selectedKey = deploymentViews[0]?.key ?? "";
    selectedServiceInstanceId = "";
  }

  function selectDeployment(deployment: DeploymentView) {
    if (selectedKey !== deployment.key) selectedServiceInstanceId = "";
    selectedKey = deployment.key;
  }

  function selectServiceInstance(instance: ServiceInstance) {
    selectedServiceInstanceId = instance.instanceId;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [
        serviceDeploymentsResponse,
        serviceInstancesResponse,
        deviceDeploymentsResponse,
        deviceInstancesResponse,
        deviceActivationsResponse,
        deviceReviewsResponse,
      ] = await Promise.all([
        trellis.request("Auth.Deployments.List", { kind: "service", limit: 500, offset: 0 }).take(),
        trellis.request("Auth.ServiceInstances.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.Deployments.List", { kind: "device", limit: 500, offset: 0 }).take(),
        trellis.request("Auth.Devices.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.DeviceUserAuthorities.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.DeviceUserAuthorities.Reviews.List", { limit: 500, offset: 0 }).take(),
      ]);

      if (isErr(serviceDeploymentsResponse)) { error = errorMessage(serviceDeploymentsResponse); return; }
      if (isErr(serviceInstancesResponse)) { error = errorMessage(serviceInstancesResponse); return; }
      if (isErr(deviceDeploymentsResponse)) { error = errorMessage(deviceDeploymentsResponse); return; }
      if (isErr(deviceInstancesResponse)) { error = errorMessage(deviceInstancesResponse); return; }
      if (isErr(deviceActivationsResponse)) { error = errorMessage(deviceActivationsResponse); return; }
      if (isErr(deviceReviewsResponse)) { error = errorMessage(deviceReviewsResponse); return; }

      serviceDeployments = (serviceDeploymentsResponse.deployments ?? []).filter((deployment): deployment is ServiceDeployment => deployment.kind === "service");
      serviceInstances = serviceInstancesResponse.instances ?? [];
      deviceDeployments = (deviceDeploymentsResponse.deployments ?? []).filter((deployment): deployment is DeviceDeployment => deployment.kind === "device");
      deviceInstances = deviceInstancesResponse.instances ?? [];
      deviceActivations = deviceActivationsResponse.activations ?? [];
      deviceReviews = deviceReviewsResponse.reviews ?? [];
      syncSelectedDeployment();
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
  <PageToolbar title="Deployments" description="Unified service and device deployment scan.">
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
          <Panel><EmptyState title="No deployment detail" description="The unified detail view appears after deployments exist." /></Panel>
        {:else if !selectedDeployment}
          <Panel><EmptyState title="Select a deployment" description="Choose a service or device deployment from the list." /></Panel>
        {:else}
          <Panel title="Deployment summary" eyebrow={`${selectedDeployment.kind} detail`} class="min-w-0">
            {#snippet actions()}
              {#if selectedDeployment.kind === "service"}
                <a class="btn btn-outline btn-sm" href={resolve(`/admin/services?deployment=${encodeURIComponent(selectedDeployment.deploymentId)}`)}>Service detail</a>
                <a class="btn btn-ghost btn-sm" href={resolve("/admin/services/instances")}>Instances</a>
                <a class="btn btn-ghost btn-sm" href={resolve(`/admin/envelopes?deployment=${encodeURIComponent(selectedDeployment.deploymentId)}`)}>Envelopes</a>
              {:else}
                <a class="btn btn-outline btn-sm" href={resolve("/admin/devices/profiles")}>Device detail</a>
                <a class="btn btn-ghost btn-sm" href={resolve("/admin/devices/instances")}>Instances</a>
                <a class="btn btn-ghost btn-sm" href={resolve("/admin/devices/reviews")}>Reviews</a>
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
                </div>
              </div>
            </div>

            <dl class="mt-4 grid gap-px overflow-hidden rounded-box border border-base-300 bg-base-300 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Kind</dt><dd class="mt-1 font-medium capitalize">{selectedDeployment.kind}</dd></div>
              <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Status</dt><dd class="mt-1"><StatusBadge label={selectedDeployment.statusLabel} status={selectedDeployment.statusVariant} /></dd></div>
              <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Instances</dt><dd class="mt-1 font-medium">{selectedDeployment.activeInstanceCount}/{selectedDeployment.totalInstanceCount} active</dd></div>
              <div class="bg-base-100 px-3 py-2.5"><dt class="text-xs text-base-content/60">Authority</dt><dd class="mt-1"><a class="btn btn-ghost btn-xs" href={resolve(`/admin/envelopes?deployment=${encodeURIComponent(selectedDeployment.deploymentId)}`)}>Open envelope</a></dd></div>
            </dl>

            <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span class="text-xs font-semibold uppercase tracking-[0.08em] text-base-content/50">Workflows</span>
              {#if selectedDeployment.kind === "service"}
                <a class="btn btn-ghost btn-xs" href={resolve("/admin/services/new")}>Create service</a>
              {:else}
                <a class="btn btn-ghost btn-xs" href={resolve("/admin/devices/activations")}>Activations</a>
                <a class="btn btn-ghost btn-xs" href={resolve("/admin/devices/profiles/new")}>Create device</a>
              {/if}
            </div>
          </Panel>

          {#if selectedServiceDeployment}
            <Panel title="Service detail" eyebrow="Instances and contracts" class="min-w-0">
              <div class="space-y-4">
                <div>
                  <h3 class="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-base-content/50">Instances</h3>
                  {#if selectedServiceInstances.length === 0}
                    <EmptyState title="No service instances" description="Provision an instance from the service instance workflow." class="py-4" />
                  {:else}
                    <div class="grid gap-4 2xl:grid-cols-[minmax(28rem,0.9fr)_minmax(0,1.1fr)]">
                      <div class="min-w-0 overflow-x-auto rounded-box border border-base-300">
                        <table class="table table-sm trellis-table">
                          <thead><tr><th>Instance</th><th>Status</th><th>Contract</th><th>Created</th></tr></thead>
                          <tbody>
                            {#each selectedServiceInstances as instance (instance.instanceId)}
                              <tr class={{ "bg-base-200/60": selectedServiceInstance?.instanceId === instance.instanceId }}>
                                <td>
                                  <button class="trellis-identifier max-w-48 truncate text-left font-medium hover:underline" onclick={() => selectServiceInstance(instance)}>
                                    {instance.instanceId}
                                  </button>
                                </td>
                                <td><StatusBadge label={instance.disabled ? "Disabled" : "Active"} status={statusForInstance(instance.disabled)} /></td>
                                <td class="trellis-identifier text-base-content/60">{instance.currentContractId ?? "—"}</td>
                                <td class="whitespace-nowrap text-base-content/60">{formatMaybeDate(instance.createdAt)}</td>
                              </tr>
                            {/each}
                          </tbody>
                        </table>
                      </div>

                      <div class="min-w-0 rounded-box border border-base-300 bg-base-100">
                        {#if selectedServiceInstance}
                          <div class="border-b border-base-300 px-4 py-3">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                              <div class="min-w-0">
                                <div class="trellis-identifier truncate font-medium">{selectedServiceInstance.instanceId}</div>
                                <div class="trellis-identifier truncate text-xs text-base-content/60">{selectedServiceInstance.instanceKey}</div>
                              </div>
                              <StatusBadge label={selectedServiceInstance.disabled ? "Disabled" : "Active"} status={statusForInstance(selectedServiceInstance.disabled)} />
                            </div>
                          </div>

                          <dl class="divide-y divide-base-300 text-sm">
                            <div class="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 px-4 py-3">
                              <dt class="text-base-content/60">Contract</dt>
                              <dd class="min-w-0">
                                <div class="trellis-identifier truncate font-medium">{selectedServiceInstance.currentContractId ?? "—"}</div>
                                <div class="trellis-identifier mt-1 truncate text-xs text-base-content/60">{selectedServiceInstance.currentContractDigest ?? "—"}</div>
                              </dd>
                            </div>
                            <div class="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 px-4 py-3">
                              <dt class="text-base-content/60">Resources</dt>
                              <dd class="trellis-token-list min-w-0">
                                {#each Object.entries(selectedServiceInstance.resourceBindings?.kv ?? {}) as [alias, binding] (alias)}
                                  <span class="badge badge-outline badge-xs">kv:{alias} <span class="trellis-identifier ml-1 text-base-content/60">{binding.bucket}</span></span>
                                {/each}
                                {#each Object.entries(selectedServiceInstance.resourceBindings?.store ?? {}) as [alias, binding] (alias)}
                                  <span class="badge badge-outline badge-xs">store:{alias} <span class="trellis-identifier ml-1 text-base-content/60">{binding.name}</span></span>
                                {/each}
                                {#if !hasResourceBindings(selectedServiceInstance)}
                                  <span class="text-base-content/60">—</span>
                                {/if}
                              </dd>
                            </div>
                            <div class="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 px-4 py-3">
                              <dt class="text-base-content/60">Capabilities</dt>
                              <dd class="trellis-token-list min-w-0">
                                {#each selectedServiceInstance.capabilities as capability (capability)}
                                  <span class="badge badge-outline badge-xs">{capability}</span>
                                {:else}
                                  <span class="text-base-content/60">—</span>
                                {/each}
                              </dd>
                            </div>
                            <div class="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 px-4 py-3">
                              <dt class="text-base-content/60">Created</dt>
                              <dd class="text-base-content/70">{formatMaybeDate(selectedServiceInstance.createdAt)}</dd>
                            </div>
                          </dl>
                        {:else}
                          <EmptyState title="Select an instance" description="Choose a service instance from the roster." class="py-4" />
                        {/if}
                      </div>
                    </div>
                  {/if}
                </div>

                <div>
                  <h3 class="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-base-content/50">Deployment authority</h3>
                  <a class="btn btn-ghost btn-xs" href={resolve(`/admin/envelopes?deployment=${encodeURIComponent(selectedServiceDeployment.deploymentId)}`)}>Review envelope</a>
                </div>
              </div>
            </Panel>
          {:else if selectedDeviceDeployment}
            <Panel title="Device detail" eyebrow="Instances, activations, reviews" class="min-w-0">
              <div class="space-y-4">
                <dl class="divide-y divide-base-300 rounded-box border border-base-300 text-sm">
                  <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Review mode</dt><dd class="font-medium">{selectedDeviceDeployment.reviewMode ?? "none"}</dd></div>
                  <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Activations</dt><dd class="font-medium">{selectedDeviceActivations.length}</dd></div>
                  <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Reviews</dt><dd class="font-medium">{selectedDeviceReviews.length}</dd></div>
                </dl>

                <div>
                  <h3 class="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-base-content/50">Instances</h3>
                  {#if selectedDeviceInstances.length === 0}
                    <EmptyState title="No device instances" description="Provision device instances from the device workflow." class="py-4" />
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
                </div>

                <div>
                  <h3 class="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-base-content/50">Activations</h3>
                  {#if selectedDeviceActivations.length === 0}
                    <EmptyState title="No activations" description="No activations are associated with this deployment." class="py-4" />
                  {:else}
                    <div class="overflow-x-auto">
                      <table class="table table-sm trellis-table">
                        <thead><tr><th>Instance</th><th>Activated by</th><th>State</th><th>Activated</th><th>Revoked</th></tr></thead>
                        <tbody>
                          {#each selectedDeviceActivations as activation (`${activation.instanceId}:${activation.activatedAt}:${activation.revokedAt ?? ""}:${activation.state}`)}
                            <tr>
                              <td><div class="trellis-identifier font-medium">{activation.instanceId}</div><div class="text-xs text-base-content/60">Name: {deviceMetadataValue(activation.instanceId, "name")}</div></td>
                              <td class="text-base-content/60">{formatActivatedBy(activation.activatedBy)}</td>
                              <td><StatusBadge label={activation.state} status={statusForActivation(activation.state)} /></td>
                              <td class="text-base-content/60">{formatDate(activation.activatedAt)}</td>
                              <td class="text-base-content/60">{formatMaybeDate(activation.revokedAt)}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  {/if}
                </div>

                <div>
                  <h3 class="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-base-content/50">Reviews</h3>
                  {#if selectedDeviceReviews.length === 0}
                    <EmptyState title="No reviews" description="No activation reviews are associated with this deployment." class="py-4" />
                  {:else}
                    <div class="overflow-x-auto">
                      <table class="table table-sm trellis-table">
                        <thead><tr><th>Review</th><th>Instance</th><th>Metadata</th><th>State</th><th>Requested</th></tr></thead>
                        <tbody>
                          {#each selectedDeviceReviews as review (review.reviewId)}
                            <tr>
                              <td class="trellis-identifier font-medium">{review.reviewId}</td>
                              <td><div class="trellis-identifier">{review.instanceId}</div><div class="trellis-identifier text-base-content/60">{review.publicIdentityKey}</div></td>
                              <td class="text-xs text-base-content/60"><div>Name: {deviceMetadataValue(review.instanceId, "name")}</div><div>Serial: {deviceMetadataValue(review.instanceId, "serialNumber")}</div><div>Model: {deviceMetadataValue(review.instanceId, "modelNumber")}</div></td>
                              <td><StatusBadge label={review.state} status={statusForReview(review.state)} /></td>
                              <td class="text-base-content/60">{formatDate(review.requestedAt)}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  {/if}
                </div>

                <div>
                  <h3 class="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-base-content/50">Deployment authority</h3>
                  <a class="btn btn-ghost btn-xs" href={resolve(`/admin/envelopes?deployment=${encodeURIComponent(selectedDeviceDeployment.deploymentId)}`)}>Review envelope</a>
                </div>
              </div>
            </Panel>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</section>
