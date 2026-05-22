<script lang="ts">
  import { isErr, type BaseError, type Result } from "@qlever-llc/result";
  import { ok } from "@qlever-llc/result";
  import type { HealthHeartbeat } from "@qlever-llc/trellis/health";
  import type {
    AuthEnvelopeExpansionsListResponse,
    DeploymentEnvelope,
  } from "@qlever-llc/trellis/auth";
  import type {
    AuthServiceInstancesListOutput,
    AuthDeploymentsListOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import type {
    JobsListOutput,
  } from "@qlever-llc/trellis/sdk/jobs";
  import type {
    TrellisCatalogOutput,
    TrellisContractGetOutput,
  } from "@qlever-llc/trellis/sdk/core";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import ConfirmationModal from "$lib/components/ConfirmationModal.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { boundaryCounts } from "$lib/envelope_console";
  import { getNotifications } from "$lib/notifications.svelte";
  import {
    appendHealthEvent,
    pruneExpiredHealthInstances,
    summarizeHealthServices,
    upsertHealthInstance,
    type HealthFeedEvent,
    type HealthInstanceView,
    type HealthServiceView,
  } from "../../../../lib/health_events.ts";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { loadJobsPageData } from "../../../../lib/jobs_page.ts";
  import { getTrellis } from "../../../../lib/trellis";

  type Deployment = Extract<AuthDeploymentsListOutput["entries"][number], { kind: "service" }>;
  type ServiceInstance = AuthServiceInstancesListOutput["entries"][number];
  type Job = JobsListOutput["entries"][number];
  type CatalogIssue = {
    issueId: string;
    kind: string;
    contractId?: string;
    digest?: string;
    message: string;
    deploymentIds: string[];
  };
  type CatalogContract = TrellisCatalogOutput["catalog"]["contracts"][number];
  type ContractDetail = TrellisContractGetOutput["contract"];
  type ContractSchema = NonNullable<ContractDetail["schemas"]>[string];
  type ExpansionRequest = AuthEnvelopeExpansionsListResponse["entries"][number];
  type ExpansionRequestRow = {
    requestId: string;
    deploymentId: string;
    requiredContracts: number;
    surfaces: number;
    resources: number;
    capabilities: number;
    createdAt: string;
  };
  type CapabilityRow = {
    capability: string;
    source: string;
    context: string;
  };
  type Surface = DeploymentEnvelope["boundary"]["surfaces"][number];
  type SchemaPanel = {
    label: string;
    schemaName: string | null;
    schema: ContractSchema | null;
    example: unknown | null;
  };
  type SchemaRow = {
    key: string;
    contractId: string;
    digest: string;
    name: string;
    schema: ContractSchema;
  };
  type JsonTokenKind = "plain" | "key" | "string" | "number" | "boolean" | "null";
  type JsonToken = {
    key: string;
    kind: JsonTokenKind;
    text: string;
  };
  type Tab = "instances" | "rpc" | "events" | "operations" | "schemas" | "resources" | "capabilities" | "dependencies" | "jobs" | "heartbeats";
  type ContractRef = `${string}:${string}`;
  type ContractRefDeploymentIds = Record<string, readonly string[]>;
  type ServiceInstanceAction = "disable" | "enable" | "remove";
  type ExpansionRequestAction = "approve" | "reject";
  type RpcTakeable<T> = { take(): Promise<T | Result<never, BaseError>> };
  type CoreRequest = {
    (method: "Trellis.Catalog", input: Record<string, never>): RpcTakeable<TrellisCatalogOutput>;
    (method: "Trellis.Contract.Get", input: { digest: string }): RpcTakeable<TrellisContractGetOutput>;
  };

  const trellis = getTrellis();
  const coreRequest = trellis.request.bind(trellis) as CoreRequest;
  const notifications = getNotifications();
  const STALE_REFRESH_MS = 5_000;

  let loading = $state(true);
  let error = $state<string | null>(null);
  let jobsUnavailableMessage = $state<string | null>(null);
  let catalogIssueError = $state<string | null>(null);
  let subscriptionError = $state<string | null>(null);
  let instanceActionPending = $state<string | null>(null);
  let expansionRequestActionPending = $state<string | null>(null);
  let confirmationModal: ConfirmationModal | undefined = $state();

  let deployments = $state.raw<Deployment[]>([]);
  let instances = $state.raw<ServiceInstance[]>([]);
  let jobs = $state.raw<Job[]>([]);
  let envelopes = $state.raw<DeploymentEnvelope[]>([]);
  let catalogContracts = $state.raw<CatalogContract[]>([]);
  let catalogIssues = $state.raw<CatalogIssue[]>([]);
  let contractDetails = $state.raw<Record<string, ContractDetail>>({});
  let contractDetailErrors = $state.raw<Record<string, string>>({});
  let contractDetailLoading = $state.raw<string[]>([]);
  let expansionRequests = $state.raw<ExpansionRequest[]>([]);
  let recentEvents = $state.raw<HealthFeedEvent[]>([]);
  let healthInstances = $state.raw<Record<string, HealthInstanceView>>({});
  let now = $state(Date.now());

  let selectedDeploymentId = $state("");
  let activeTab = $state<Tab>("instances");
  let selectedSurfaceKey = $state<string | null>(null);
  let search = $state("");

  const tabs: Tab[] = ["instances", "rpc", "events", "operations", "schemas", "resources", "capabilities", "dependencies", "jobs", "heartbeats"];

  const selectedDeployment = $derived(deployments.find((deployment) => deployment.deploymentId === selectedDeploymentId) ?? null);
  const serviceDeploymentIds = $derived.by(() => new Set(deployments.map((deployment) => deployment.deploymentId)));
  const selectedInstances = $derived(instances.filter((instance) => instance.deploymentId === selectedDeploymentId));
  const activeInstances = $derived(selectedInstances.filter((instance) => !instance.disabled));
  const selectedInstanceIds = $derived(new Set(selectedInstances.map((instance) => instance.instanceId)));
  const selectedServiceContractRefs = $derived(uniqueContractRefs(selectedInstances));
  const contractRefDeploymentIds = $derived.by(() => {
    const refs: ContractRefDeploymentIds = {};
    for (const instance of instances) {
      const ref = contractRef(instance.currentContractId, instance.currentContractDigest);
      if (!ref) continue;
      const deploymentIds = refs[ref] ?? [];
      refs[ref] = deploymentIds.includes(instance.deploymentId) ? deploymentIds : [...deploymentIds, instance.deploymentId];
    }
    return refs;
  });
  const selectedContractRefs = $derived(uniqueContractRefsForInstances(selectedInstances, contractRefDeploymentIds));
  const healthServices = $derived(summarizeHealthServices(healthInstances, now));
  const selectedHealthService = $derived.by(() => {
    const byServiceName = healthServices.find((service) => service.serviceName === selectedDeploymentId);
    if (byServiceName) return byServiceName;
    const byRuntimeInstance = healthServices.find((service) => service.instances.some((instance) => selectedInstanceIds.has(instance.instanceId)));
    if (byRuntimeInstance) return byRuntimeInstance;
    return healthServices.find((service) => healthServiceMatchesContractRefs(service, selectedContractRefs)) ?? null;
  });
  const selectedEvents = $derived(
    recentEvents.filter((event) =>
      event.heartbeat.service.name === selectedDeploymentId ||
      selectedInstanceIds.has(event.heartbeat.service.instanceId) ||
      contractRefMatches(event.heartbeat.service.contractId, event.heartbeat.service.contractDigest, selectedContractRefs)
    ),
  );
  const selectedJobs = $derived(jobs.filter((job) => job.service === selectedDeploymentId));
  const selectedEnvelope = $derived(envelopes.find((envelope) => envelope.deploymentId === selectedDeploymentId && envelope.kind === "service") ?? null);
  const selectedRequestRows = $derived.by(() =>
    expansionRequests
      .filter((request) => request.deploymentId === selectedDeploymentId && request.state === "pending")
      .map(expansionRequestRow)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)),
  );
  const allPendingRequestRows = $derived.by(() =>
    expansionRequests
      .filter((request) => request.state === "pending" && serviceDeploymentIds.has(request.deploymentId))
      .map(expansionRequestRow)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)),
  );
  const filteredDeployments = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return deployments;
    return deployments.filter((deployment) => deployment.deploymentId.toLowerCase().includes(term));
  });
  const disabledCount = $derived(deployments.filter((deployment) => deployment.disabled).length);
  const selectedCapabilityCount = $derived(capabilityRows(selectedEnvelope, selectedInstances).length);
  const selectedSchemaRows = $derived(schemaRowsForContractRefs(selectedServiceContractRefs));
  const selectedStatus = $derived.by(() => {
    if (selectedDeployment?.disabled) return { label: "Disabled", status: "offline" as const };
    if (selectedHealthService) return { label: statusLabel(selectedHealthService.status), status: selectedHealthService.status };
    if (activeInstances.length > 0) return { label: "Active", status: "healthy" as const };
    return { label: "No instances", status: "offline" as const };
  });

  function syncSelectedDeployment(nextDeployments: Deployment[]) {
    const requestedDeploymentId = page.url.searchParams.get("deployment");
    if (requestedDeploymentId && nextDeployments.some((deployment) => deployment.deploymentId === requestedDeploymentId)) {
      selectedDeploymentId = requestedDeploymentId;
      return;
    }

    if (nextDeployments.some((deployment) => deployment.deploymentId === selectedDeploymentId)) return;
    selectedDeploymentId = nextDeployments[0]?.deploymentId ?? "";
  }

  function contractRef(contractId?: string | null, contractDigest?: string | null): ContractRef | null {
    const id = contractId?.trim();
    const digest = contractDigest?.trim();
    return id && digest ? `${id}:${digest}` : null;
  }

  function uniqueContractRefsForInstances(serviceInstances: ServiceInstance[], refDeploymentIds: ContractRefDeploymentIds): ContractRef[] {
    const refs: ContractRef[] = [];
    for (const instance of serviceInstances) {
      const ref = contractRef(instance.currentContractId, instance.currentContractDigest);
      if (ref && refDeploymentIds[ref]?.length === 1 && !refs.includes(ref)) refs.push(ref);
    }
    return refs;
  }

  function uniqueContractRefs(serviceInstances: ServiceInstance[]): ContractRef[] {
    const refs: ContractRef[] = [];
    for (const instance of serviceInstances) {
      const ref = contractRef(instance.currentContractId, instance.currentContractDigest);
      if (ref && !refs.includes(ref)) refs.push(ref);
    }
    return refs;
  }

  function splitContractRef(ref: ContractRef): { contractId: string; digest: string } {
    const index = ref.lastIndexOf(":");
    return { contractId: ref.slice(0, index), digest: ref.slice(index + 1) };
  }

  function surfaceKey(surface: Surface): string {
    return `${surface.contractId}:${surface.kind}:${surface.name}:${surface.action}`;
  }

  function catalogDigestForContractId(contractId: string): string | null {
    return catalogContracts.find((contract) => contract.id === contractId)?.digest ??
      selectedInstances.find((instance) => instance.currentContractId === contractId)?.currentContractDigest ??
      instances.find((instance) => instance.currentContractId === contractId)?.currentContractDigest ??
      null;
  }

  function objectRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  function schemaRefName(value: unknown): string | null {
    if (typeof value === "string" && value.trim()) return value;
    const record = objectRecord(value);
    const schema = record?.schema;
    return typeof schema === "string" && schema.trim() ? schema : null;
  }

  function schemaFromRef(contract: ContractDetail, value: unknown): { schemaName: string | null; schema: ContractSchema | null } {
    const schemaName = schemaRefName(value);
    if (schemaName) return { schemaName, schema: contract.schemas?.[schemaName] ?? null };
    return { schemaName: null, schema: objectRecord(value) ? value as ContractSchema : null };
  }

  function schemaPanelsForSurface(surface: Surface): SchemaPanel[] {
    const digest = catalogDigestForContractId(surface.contractId);
    const contract = digest ? contractDetails[digest] : null;
    if (!contract) return [];

    if (surface.kind === "rpc") {
      const method = objectRecord(contract.rpc)?.[surface.name];
      const methodRecord = objectRecord(method);
      const input = schemaFromRef(contract, methodRecord?.input);
      const output = schemaFromRef(contract, methodRecord?.output);
      return [
        { label: "Input", ...input, example: input.schema ? exampleFromSchema(input.schema) : null },
        { label: "Output", ...output, example: output.schema ? exampleFromSchema(output.schema) : null },
      ];
    }

    if (surface.kind === "event") {
      const event = objectRecord(contract.events)?.[surface.name];
      const eventSchema = schemaFromRef(contract, objectRecord(event)?.event);
      return [{ label: "Event", ...eventSchema, example: eventSchema.schema ? exampleFromSchema(eventSchema.schema) : null }];
    }

    if (surface.kind === "operation") {
      const operation = objectRecord(contract.operations)?.[surface.name];
      const operationRecord = objectRecord(operation);
      const input = schemaFromRef(contract, operationRecord?.input);
      const output = schemaFromRef(contract, operationRecord?.output);
      return [
        { label: "Input", ...input, example: input.schema ? exampleFromSchema(input.schema) : null },
        { label: "Output", ...output, example: output.schema ? exampleFromSchema(output.schema) : null },
      ];
    }

    return [];
  }

  function referencedSchemaNames(contract: ContractDetail): string[] {
    const names: string[] = [];
    for (const section of [contract.rpc, contract.events, contract.operations]) {
      const records = objectRecord(section);
      if (!records) continue;
      for (const value of Object.values(records)) {
        const record = objectRecord(value);
        for (const key of ["input", "output", "event"] as const) {
          const name = schemaRefName(record?.[key]);
          if (name && !names.includes(name)) names.push(name);
        }
      }
    }
    return names;
  }

  function schemaRowsForContractRefs(refs: readonly ContractRef[]): SchemaRow[] {
    const rows: SchemaRow[] = [];
    for (const ref of refs) {
      const { contractId, digest } = splitContractRef(ref);
      const contract = contractDetails[digest];
      if (!contract?.schemas) continue;
      const referenced = referencedSchemaNames(contract);
      for (const name of contract.exports?.schemas ?? []) {
        const schema = contract.schemas[name];
        if (schema === undefined || referenced.includes(name)) continue;
        rows.push({ key: `${digest}:${name}`, contractId, digest, name, schema });
      }
    }
    return rows;
  }

  function exampleFromSchema(schema: unknown): unknown {
    if (schema === true) return {};
    if (schema === false) return null;
    const record = objectRecord(schema);
    if (!record) return null;
    const type = record.type;
    if (type === "string") return "string";
    if (type === "number" || type === "integer") return 0;
    if (type === "boolean") return true;
    if (type === "array") return [exampleFromSchema(record.items)];
    if (type === "object" || objectRecord(record.properties)) {
      const output: Record<string, unknown> = {};
      const properties = objectRecord(record.properties) ?? {};
      const required = Array.isArray(record.required) ? record.required.filter((value): value is string => typeof value === "string") : Object.keys(properties);
      for (const key of required) output[key] = exampleFromSchema(properties[key]);
      return output;
    }
    if (Array.isArray(record.enum) && record.enum.length > 0) return record.enum[0];
    return null;
  }

  function jsonString(value: unknown): string {
    return JSON.stringify(value, null, 2) ?? "null";
  }

  function jsonTokenClass(kind: JsonTokenKind): string | undefined {
    if (kind === "plain") return undefined;
    return `json-${kind}`;
  }

  function jsonTokens(json: string): JsonToken[] {
    const tokens: JsonToken[] = [];
    const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    let offset = 0;
    for (const match of json.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > offset) tokens.push({ key: `plain:${offset}`, kind: "plain", text: json.slice(offset, index) });
      const [text, quoted, colon] = match;
      if (quoted) {
        tokens.push({ key: `token:${index}`, kind: colon ? "key" : "string", text: quoted });
        if (colon) tokens.push({ key: `colon:${index}`, kind: "plain", text: colon });
      } else if (text === "true" || text === "false") {
        tokens.push({ key: `token:${index}`, kind: "boolean", text });
      } else if (text === "null") {
        tokens.push({ key: `token:${index}`, kind: "null", text });
      } else {
        tokens.push({ key: `token:${index}`, kind: "number", text });
      }
      offset = index + text.length;
    }
    if (offset < json.length) tokens.push({ key: `plain:${offset}`, kind: "plain", text: json.slice(offset) });
    return tokens;
  }

  function healthServiceMatchesContractRefs(service: HealthServiceView, refs: readonly ContractRef[]): boolean {
    return service.instances.some((instance) => contractRefMatches(instance.contractId, instance.contractDigest, refs));
  }

  function contractRefMatches(contractId: string, contractDigest: string, refs: readonly ContractRef[]): boolean {
    const ref = contractRef(contractId, contractDigest);
    return ref ? refs.includes(ref) : false;
  }

  function healthServiceForDeployment(
    deploymentId: string,
    serviceInstances: ServiceInstance[],
    services: HealthServiceView[],
    refDeploymentIds: ContractRefDeploymentIds,
  ): HealthServiceView | null {
    const byServiceName = services.find((service) => service.serviceName === deploymentId);
    if (byServiceName) return byServiceName;
    const instanceIds = serviceInstances.map((instance) => instance.instanceId);
    const byRuntimeInstance = services.find((service) => service.instances.some((instance) => instanceIds.includes(instance.instanceId)));
    if (byRuntimeInstance) return byRuntimeInstance;
    const refs = uniqueContractRefsForInstances(serviceInstances, refDeploymentIds);
    return services.find((service) => healthServiceMatchesContractRefs(service, refs)) ?? null;
  }

  function healthInstanceForServiceInstance(instance: ServiceInstance): HealthInstanceView | null {
    const exact = selectedHealthService?.instances.find((healthInstance) => healthInstance.instanceId === instance.instanceId);
    if (exact) return exact;

    const ref = contractRef(instance.currentContractId, instance.currentContractDigest);
    if (!ref) return null;
    const serviceInstancesWithRef = selectedInstances.filter((serviceInstance) =>
      contractRef(serviceInstance.currentContractId, serviceInstance.currentContractDigest) === ref
    );
    const healthInstancesWithRef = selectedHealthService?.instances.filter((healthInstance) =>
      contractRef(healthInstance.contractId, healthInstance.contractDigest) === ref
    ) ?? [];
    return serviceInstancesWithRef.length === 1 && healthInstancesWithRef.length === 1 ? healthInstancesWithRef[0] : null;
  }

  function tabLabel(tab: Tab): string {
    if (tab === "rpc") return "RPC";
    if (tab === "events") return "Events";
    if (tab === "heartbeats") return "Heartbeats";
    return tab[0].toUpperCase() + tab.slice(1);
  }

  function surfaceLabel(kind: DeploymentEnvelope["boundary"]["surfaces"][number]["kind"]): string {
    if (kind === "rpc") return "RPC";
    if (kind === "event") return "Event";
    if (kind === "operation") return "Operation";
    return "Feed";
  }

  function surfacesForTab(tab: Tab): DeploymentEnvelope["boundary"]["surfaces"] {
    if (!selectedEnvelope) return [];
    if (tab === "rpc") return selectedEnvelope.boundary.surfaces.filter((surface) => surface.kind === "rpc");
    if (tab === "events") return selectedEnvelope.boundary.surfaces.filter((surface) => surface.kind === "event");
    if (tab === "operations") return selectedEnvelope.boundary.surfaces.filter((surface) => surface.kind === "operation" || surface.kind === "feed");
    return [];
  }

  function tabId(tab: Tab): string {
    return `service-detail-tab-${tab}`;
  }

  function tabPanelId(tab: Tab): string {
    return `service-detail-panel-${tab}`;
  }

  function formatRuntime(runtime?: string, runtimeVersion?: string): string | null {
    const runtimeName = runtime?.trim();
    if (!runtimeName) return null;
    const version = runtimeVersion?.trim();
    return version ? `${runtimeName} ${version}` : runtimeName;
  }

  function formatMaybeDate(value?: string): string {
    return value ? formatDate(value) : "—";
  }

  function formatSeenAt(value?: number): string {
    return value ? formatDate(new Date(value).toISOString()) : "—";
  }

  function compactUniqueValues(values: readonly string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  function serviceDeploymentsForContract(contractId: string): Deployment[] {
    const deploymentIds = new Set(
      instances
        .filter((instance) => instance.currentContractId === contractId)
        .map((instance) => instance.deploymentId),
    );
    return deployments.filter((deployment) => deploymentIds.has(deployment.deploymentId));
  }

  function capabilityRows(envelope: DeploymentEnvelope | null, serviceInstances: ServiceInstance[]): CapabilityRow[] {
    const rows: CapabilityRow[] = [];
    for (const capability of compactUniqueValues(envelope?.boundary.capabilities ?? [])) {
      rows.push({ capability, source: "Deployment envelope", context: "Boundary capability" });
    }
    for (const instance of serviceInstances) {
      for (const capability of compactUniqueValues(instance.capabilities)) {
        rows.push({ capability, source: "Instance effective", context: instance.instanceId });
      }
    }
    return rows;
  }

  function expansionRequestRow(request: ExpansionRequest): ExpansionRequestRow {
    const counts = boundaryCounts(request.delta);
    return {
      requestId: request.requestId,
      deploymentId: request.deploymentId,
      requiredContracts: counts.requiredContracts,
      surfaces: counts.requiredSurfaces + counts.optionalSurfaces,
      resources: counts.requiredResources + counts.optionalResources,
      capabilities: counts.capabilities,
      createdAt: request.createdAt,
    };
  }

  function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
  }

  function expansionRequestSummary(request: ExpansionRequestRow): string {
    return [
      plural(request.requiredContracts, "contract"),
      plural(request.surfaces, "surface"),
      plural(request.resources, "resource"),
      plural(request.capabilities, "capability"),
    ].join(" · ");
  }

  function statusForJob(state: Job["state"]): "healthy" | "degraded" | "unhealthy" | "offline" {
    if (state === "completed" || state === "active") return "healthy";
    if (state === "pending" || state === "retry") return "degraded";
    if (state === "failed" || state === "dead") return "unhealthy";
    return "offline";
  }

  function statusLabel(status: string): string {
    if (status === "healthy") return "Healthy";
    if (status === "degraded") return "Degraded";
    if (status === "unhealthy") return "Unhealthy";
    if (status === "offline") return "Offline";
    return status;
  }

  function badgeClassForStatus(status: string): string {
    if (status === "Healthy" || status === "healthy" || status === "Active") return "badge-success";
    if (status === "Degraded" || status === "degraded") return "badge-warning";
    if (status === "Unhealthy" || status === "unhealthy") return "badge-error";
    return "badge-neutral";
  }

  function dotClassForStatus(status: string): string {
    if (status === "Healthy" || status === "healthy" || status === "Active") return "bg-success";
    if (status === "Degraded" || status === "degraded") return "bg-warning";
    if (status === "Unhealthy" || status === "unhealthy") return "bg-error";
    return "bg-base-content/30";
  }

  function selectDeployment(nextDeploymentId: string) {
    selectedDeploymentId = nextDeploymentId;
    selectedSurfaceKey = null;
  }

  function selectTab(tab: Tab) {
    activeTab = tab;
    if (tab === "schemas") void ensureSelectedServiceContractDetails();
  }

  async function ensureSelectedServiceContractDetails() {
    await Promise.all(selectedServiceContractRefs.map((ref) => ensureContractDetailByDigest(splitContractRef(ref).digest)));
  }

  async function ensureContractDetailForSurface(surface: Surface) {
    const digest = catalogDigestForContractId(surface.contractId);
    if (!digest) return;
    await ensureContractDetailByDigest(digest);
  }

  async function ensureContractDetailByDigest(digest: string) {
    if (contractDetails[digest] || contractDetailLoading.includes(digest)) return;
    contractDetailLoading = [...contractDetailLoading, digest];
    const { [digest]: _previousError, ...nextErrors } = contractDetailErrors;
    contractDetailErrors = nextErrors;
    try {
      const response = await coreRequest("Trellis.Contract.Get", { digest }).take();
      if (isErr(response)) {
        contractDetailErrors = { ...contractDetailErrors, [digest]: errorMessage(response) };
        return;
      }
      contractDetails = { ...contractDetails, [digest]: response.contract };
    } catch (cause) {
      contractDetailErrors = { ...contractDetailErrors, [digest]: errorMessage(cause) };
    } finally {
      contractDetailLoading = contractDetailLoading.filter((entry) => entry !== digest);
    }
  }

  function toggleSurface(surface: Surface) {
    const key = surfaceKey(surface);
    selectedSurfaceKey = selectedSurfaceKey === key ? null : key;
    if (selectedSurfaceKey) void ensureContractDetailForSurface(surface);
  }

  async function load() {
    loading = true;
    error = null;
    jobsUnavailableMessage = null;
    catalogIssueError = null;
    try {
      const [deploymentsRes, instancesRes, envelopesRes, expansionRequestsRes, catalogRes] = await Promise.all([
        trellis.request("Auth.Deployments.List", { kind: "service", limit: 500, offset: 0 }).take(),
        trellis.request("Auth.ServiceInstances.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.Envelopes.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.EnvelopeExpansions.List", { state: "pending", limit: 500, offset: 0 }).take(),
        coreRequest("Trellis.Catalog", {}).take(),
      ]);
      if (isErr(deploymentsRes)) { error = errorMessage(deploymentsRes); return; }
      if (isErr(instancesRes)) { error = errorMessage(instancesRes); return; }
      if (isErr(envelopesRes)) { error = errorMessage(envelopesRes); return; }
      if (isErr(expansionRequestsRes)) { error = errorMessage(expansionRequestsRes); return; }
      if (isErr(catalogRes)) catalogIssueError = errorMessage(catalogRes);
      deployments = (deploymentsRes.entries ?? []).filter((deployment): deployment is Deployment => deployment.kind === "service");
      instances = instancesRes.entries ?? [];
      envelopes = (envelopesRes.entries ?? []).filter((envelope) => envelope.kind === "service");
      expansionRequests = expansionRequestsRes.entries ?? [];
      if (isErr(catalogRes)) {
        catalogContracts = [];
        catalogIssues = [];
      } else {
        catalogContracts = catalogRes.catalog.contracts ?? [];
        const issues = objectRecord(catalogRes.catalog)?.issues;
        catalogIssues = Array.isArray(issues) ? issues as CatalogIssue[] : [];
      }

      const jobsData = await loadJobsPageData({
        listServices: (input) => trellis.request("Jobs.ListServices", input),
        listJobs: (filter) => trellis.request("Jobs.List", filter),
      }).catch((jobsError: unknown) => ({
        available: false,
        message: `Jobs admin runtime is unavailable: ${errorMessage(jobsError)}`,
        services: [],
        jobs: [],
        count: 0,
        offset: 0,
        limit: 50,
      }));
      jobs = jobsData.jobs;
      jobsUnavailableMessage = jobsData.available ? null : jobsData.message ?? "Jobs admin runtime is unavailable.";
      syncSelectedDeployment(deployments);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function refreshAuthorityReviewData() {
    catalogIssueError = null;
    const [envelopesRes, expansionRequestsRes, catalogRes] = await Promise.all([
      trellis.request("Auth.Envelopes.List", { limit: 500, offset: 0 }).take(),
      trellis.request("Auth.EnvelopeExpansions.List", { state: "pending", limit: 500, offset: 0 }).take(),
      coreRequest("Trellis.Catalog", {}).take(),
    ]);

    if (isErr(envelopesRes)) {
      error = errorMessage(envelopesRes);
    } else {
      envelopes = (envelopesRes.entries ?? []).filter((envelope) => envelope.kind === "service");
    }

    if (isErr(expansionRequestsRes)) {
      error = errorMessage(expansionRequestsRes);
    } else {
      expansionRequests = expansionRequestsRes.entries ?? [];
    }

    if (isErr(catalogRes)) {
      catalogIssueError = errorMessage(catalogRes);
      catalogContracts = [];
      catalogIssues = [];
    } else {
      catalogContracts = catalogRes.catalog.contracts ?? [];
      const issues = objectRecord(catalogRes.catalog)?.issues;
      catalogIssues = Array.isArray(issues) ? issues as CatalogIssue[] : [];
    }
  }

  async function handleServiceInstanceAction(instance: ServiceInstance, action: ServiceInstanceAction) {
    if (action === "disable" || action === "remove") {
      const confirmed = await confirmationModal?.confirm({
        title: action === "remove" ? "Remove service instance?" : "Disable service instance?",
        message: action === "remove"
          ? "This deletes the provisioned identity and cannot be undone from the console."
          : "This prevents the service instance from authenticating until it is explicitly enabled again.",
        confirmLabel: action === "remove" ? "Remove instance" : "Disable instance",
        targetLabel: "Service instance",
        targetName: instance.instanceId,
        expectedValue: instance.instanceId,
      });
      if (!confirmed) return;
    }

    const pendingKey = `${action}:${instance.instanceId}`;
    instanceActionPending = pendingKey;
    error = null;
    try {
      const response = action === "disable"
        ? await trellis.request("Auth.ServiceInstances.Disable", { instanceId: instance.instanceId }).take()
        : action === "enable"
        ? await trellis.request("Auth.ServiceInstances.Enable", { instanceId: instance.instanceId }).take()
        : await trellis.request("Auth.ServiceInstances.Remove", { instanceId: instance.instanceId }).take();
      if (isErr(response)) {
        error = errorMessage(response);
        return;
      }
      notifications.success(`Service instance ${instance.instanceId} ${action === "remove" ? "removed" : action === "enable" ? "enabled" : "disabled"}.`, "Updated");
      await load();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      instanceActionPending = null;
    }
  }

  async function handleExpansionRequestAction(request: ExpansionRequestRow, action: ExpansionRequestAction) {
    if (action === "reject") {
      const confirmed = await confirmationModal?.confirm({
        title: "Reject envelope expansion?",
        message: "This rejects the pending authority request. The service will keep waiting until it requests authority again or is redeployed with a compatible envelope.",
        confirmLabel: "Reject request",
        targetLabel: "Expansion request",
        targetName: request.requestId,
        expectedValue: request.requestId,
        details: `${request.deploymentId}: ${expansionRequestSummary(request)}`,
      });
      if (!confirmed) return;
    }

    const pendingKey = `${action}:${request.requestId}`;
    expansionRequestActionPending = pendingKey;
    error = null;
    try {
      const response = action === "approve"
        ? await trellis.request("Auth.EnvelopeExpansions.Approve", { requestId: request.requestId, reason: "Approved from Console service runtime." }).take()
        : await trellis.request("Auth.EnvelopeExpansions.Reject", { requestId: request.requestId, reason: "Rejected from Console service runtime." }).take();
      if (isErr(response)) {
        error = errorMessage(response);
        return;
      }
      notifications.success(
        `${action === "approve" ? "Approved" : "Rejected"} envelope expansion for ${request.deploymentId}.`,
        "Authority request updated",
      );
      expansionRequests = expansionRequests.filter((entry) => entry.requestId !== request.requestId);
      await refreshAuthorityReviewData();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      expansionRequestActionPending = null;
    }
  }

  function ingestHeartbeat(heartbeat: HealthHeartbeat) {
    const receivedAt = Date.now();
    healthInstances = upsertHealthInstance(pruneExpiredHealthInstances(healthInstances, receivedAt), heartbeat, receivedAt);
    recentEvents = appendHealthEvent(recentEvents, heartbeat, receivedAt);
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
        const result = await trellis.event("Health.Heartbeat", {}, handleHeartbeat, {
          mode: "ephemeral",
          replay: "new",
          signal: controller.signal,
        });
        if (result.isErr()) subscriptionError = errorMessage(result.error);
      } catch (e) {
        subscriptionError = errorMessage(e);
      }
    })();

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Service runtime" description="Inspect service deployment health, instances, jobs, authority requests, permissions, and events.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
      <a class="btn btn-outline btn-sm" href={resolve("/admin/services/new")}>Create service</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}
  {#if subscriptionError}
    <div class="alert alert-warning"><span>Heartbeat subscription unavailable: {subscriptionError}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading services" /></Panel>
  {:else}
    <div class="grid min-h-[calc(100vh-12rem)] items-stretch gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <Panel title="Deployments" eyebrow={`${deployments.length} deployment${deployments.length === 1 ? "" : "s"}`} class="flex min-w-0 flex-col xl:h-full [&>.card-body]:flex-1">
        <div class="mb-3">
          <label class="input input-bordered input-sm flex items-center gap-2">
            <Icon name="search" size={14} class="text-base-content/50" />
            <input bind:value={search} class="grow" placeholder="Search deployments" aria-label="Search deployments" />
          </label>
        </div>

        {#if deployments.length === 0}
          <EmptyState title="No deployments" description="Run services create to add a deployment." />
        {:else}
          <div class="space-y-2">
            {#each filteredDeployments as deployment (deployment.deploymentId)}
              {@const serviceInstances = instances.filter((instance) => instance.deploymentId === deployment.deploymentId)}
              {@const activeServiceInstances = serviceInstances.filter((instance) => !instance.disabled)}
              {@const healthService = healthServiceForDeployment(deployment.deploymentId, serviceInstances, healthServices, contractRefDeploymentIds)}
              {@const rowStatus = deployment.disabled ? "Disabled" : (healthService ? statusLabel(healthService.status) : (activeServiceInstances.length > 0 ? "Active" : "No instances"))}
              <button
                type="button"
                class={[
                  "w-full rounded-box border p-3 text-left transition-colors",
                  selectedDeploymentId === deployment.deploymentId ? "border-primary bg-primary/5" : "border-base-300 bg-base-100 hover:border-base-content/20",
                ]}
                onclick={() => selectDeployment(deployment.deploymentId)}
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class={["h-2.5 w-2.5 rounded-full", dotClassForStatus(rowStatus)]}></span>
                      <span class="trellis-identifier truncate font-medium">{deployment.deploymentId}</span>
                    </div>
                    <div class="mt-1 text-xs text-base-content/60">{activeServiceInstances.length}/{serviceInstances.length} active instances</div>
                  </div>
                  <span class={["badge badge-sm", badgeClassForStatus(rowStatus)]}>{rowStatus}</span>
                </div>
              </button>
            {:else}
              <EmptyState title="No matches" description="Try a different deployment ID." class="py-4" />
            {/each}
          </div>
        {/if}

        {#snippet footer()}
          <span>{disabledCount} disabled / archived</span>
        {/snippet}
      </Panel>

      <div class="flex min-w-0 flex-col gap-4">
        {#if allPendingRequestRows.length > 0}
          <div class="rounded-box border border-warning/30 bg-warning/10 px-4 py-2 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
                  <span><strong>{allPendingRequestRows.length}</strong> pending service authority expansion request{allPendingRequestRows.length === 1 ? "" : "s"} need authority review/approval</span>
                  <div class="flex flex-wrap gap-1">
                    {#each allPendingRequestRows.slice(0, 3) as request (request.requestId)}
                  <button type="button" class="btn btn-ghost btn-xs trellis-identifier" onclick={() => { selectedDeploymentId = request.deploymentId; activeTab = "instances"; }}>{request.deploymentId}: {expansionRequestSummary(request)}</button>
                    {/each}
                  </div>
            </div>
          </div>
        {/if}

        {#if catalogIssues.length > 0 || catalogIssueError}
          <div class="rounded-box border border-error/30 bg-error/10 px-4 py-2 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span>
                {#if catalogIssueError}
                  Forced update status unavailable: {catalogIssueError}
                {:else}
                  <strong>{catalogIssues.length}</strong> forced contract update{catalogIssues.length === 1 ? "" : "s"} need review
                {/if}
              </span>
              <a class="btn btn-error btn-outline btn-xs" href={resolve("/admin/services/repair")}>Open forced update</a>
            </div>
          </div>
        {/if}

        {#if !selectedDeployment}
          <Panel><EmptyState title="Select a deployment" description="Choose a deployment from the left rail to inspect runtime state." /></Panel>
        {:else}
          <Panel class="flex min-w-0 flex-1 flex-col [&>.card-body]:flex-1">
            <div class="flex flex-wrap items-start justify-between gap-3 border-b border-base-300 pb-3">
              <div class="flex min-w-0 items-start gap-3">
                <div class="rounded-box bg-primary/10 p-2.5 text-primary"><Icon name="server" size={22} /></div>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="trellis-identifier truncate text-lg font-semibold">{selectedDeployment.deploymentId}</h2>
                    <StatusBadge label={selectedStatus.label} status={selectedStatus.status} />
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span class="badge badge-outline badge-sm">{activeInstances.length}/{selectedInstances.length} active instances</span>
              {#if selectedHealthService}
                {@const runtimeLabel = formatRuntime(selectedHealthService.runtime, selectedHealthService.instances[0]?.runtimeVersion)}
                <span class="badge badge-outline badge-sm">Heartbeat {formatSeenAt(selectedHealthService.lastSeenAt)}</span>
                {#if runtimeLabel}
                  <span class="badge badge-outline badge-sm">{runtimeLabel}</span>
                {/if}
              {/if}
              {#if selectedRequestRows.length > 0}
                <span class="badge badge-warning badge-sm">{selectedRequestRows.length} authority request{selectedRequestRows.length === 1 ? "" : "s"} awaiting review</span>
              {/if}
              {#if !jobsUnavailableMessage && selectedJobs.length > 0}
                <button type="button" class="btn btn-ghost btn-xs" onclick={() => (activeTab = "jobs")}>{selectedJobs.length} job{selectedJobs.length === 1 ? "" : "s"}</button>
              {/if}
              {#if selectedCapabilityCount > 0}
                <span class="badge badge-outline badge-sm">{selectedCapabilityCount} capabilities</span>
              {/if}
            </div>

            {#if selectedRequestRows.length > 0}
              <div class="mt-3 rounded-box border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
                <div class="font-medium">Authority review required</div>
                <div class="mt-1 text-xs text-base-content/70">Pending requests need authority approval before new contracts, resources, or capabilities are granted.</div>
                <div class="mt-2 flex flex-wrap gap-1">
                  {#each selectedRequestRows.slice(0, 3) as request (request.requestId)}
                    <div class="flex flex-wrap items-center gap-1 rounded-box border border-base-300 bg-base-100/60 px-2 py-1">
                      <span class="badge badge-outline badge-sm">{expansionRequestSummary(request)}</span>
                      <button
                        type="button"
                        class="btn btn-success btn-xs"
                        disabled={expansionRequestActionPending !== null}
                        onclick={() => void handleExpansionRequestAction(request, "approve")}
                      >{expansionRequestActionPending === `approve:${request.requestId}` ? "Approving..." : "Approve"}</button>
                      <button
                        type="button"
                        class="btn btn-error btn-outline btn-xs"
                        disabled={expansionRequestActionPending !== null}
                        onclick={() => void handleExpansionRequestAction(request, "reject")}
                      >{expansionRequestActionPending === `reject:${request.requestId}` ? "Rejecting..." : "Reject"}</button>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <div class="tabs tabs-box tabs-sm mt-4 w-fit bg-base-200/70 p-1" role="tablist" aria-label="Deployment detail sections">
              {#each tabs as tab (tab)}
                <button type="button" id={tabId(tab)} role="tab" aria-selected={activeTab === tab} aria-controls={tabPanelId(tab)} class={["tab rounded-field px-4", activeTab === tab && "tab-active bg-base-100 shadow-sm"]} onclick={() => selectTab(tab)}>{tabLabel(tab)}</button>
              {/each}
            </div>

            <div id={tabPanelId(activeTab)} class="mt-4 flex-1" role="tabpanel" aria-labelledby={tabId(activeTab)}>
            {#if activeTab === "instances"}
              {#if selectedInstances.length === 0}
                <EmptyState title="No instances" description="Provisioned service runtime identities appear here after they are registered." />
              {:else}
                <div class="overflow-x-auto">
                  <table class="table table-sm trellis-table">
                    <thead><tr><th>Instance</th><th>Created</th><th>Heartbeat</th><th>Runtime</th><th>Actions</th></tr></thead>
                    <tbody>
                      {#each selectedInstances as instance (instance.instanceId)}
                        {@const heartbeat = healthInstanceForServiceInstance(instance)}
                        {@const runtimeLabel = heartbeat ? formatRuntime(heartbeat.runtime, heartbeat.runtimeVersion) : null}
                        <tr>
                          <td class="min-w-64"><div class="flex items-center gap-2"><span class="trellis-identifier font-medium">{instance.instanceId}</span>{#if instance.disabled}<StatusBadge label="Disabled" status="offline" />{:else}<StatusBadge label="Active" status="healthy" />{/if}</div><div class="trellis-identifier text-xs text-base-content/50">{instance.instanceKey}</div></td>
                          <td class="text-base-content/60">{formatMaybeDate(instance.createdAt)}</td>
                          <td>{#if heartbeat}<div class="flex items-center gap-2"><StatusBadge label={statusLabel(heartbeat.status)} status={heartbeat.status} /><span class="text-xs text-base-content/60">{formatSeenAt(heartbeat.lastSeenAt)}</span></div>{:else}<span class="text-xs text-base-content/50">No matched heartbeat</span>{/if}</td>
                          <td>{runtimeLabel ?? "—"}</td>
                          <td>
                            <div class="flex flex-wrap gap-1">
                              {#if instance.disabled}
                                <button type="button" class="btn btn-ghost btn-xs" disabled={instanceActionPending === `enable:${instance.instanceId}`} onclick={() => void handleServiceInstanceAction(instance, "enable")}>Enable</button>
                                <button type="button" class="btn btn-error btn-outline btn-xs" disabled={instanceActionPending === `remove:${instance.instanceId}`} onclick={() => void handleServiceInstanceAction(instance, "remove")}>Remove</button>
                              {:else}
                                <button type="button" class="btn btn-error btn-outline btn-xs" disabled={instanceActionPending === `disable:${instance.instanceId}`} onclick={() => void handleServiceInstanceAction(instance, "disable")}>Disable</button>
                              {/if}
                            </div>
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            {:else if activeTab === "rpc" || activeTab === "events" || activeTab === "operations"}
              {#if !selectedEnvelope}
                <EmptyState title="No API boundary" description="No current service envelope was returned for this deployment." />
              {:else}
                {@const apiSurfaces = surfacesForTab(activeTab)}
                <div class="space-y-2">
                  <div class="overflow-x-auto">
                    <table class="table table-sm trellis-table">
                      <thead><tr>{#if activeTab === "operations"}<th>Type</th>{/if}<th>Surface</th><th>Action</th><th>Requirement</th><th>Contract</th></tr></thead>
                      <tbody>
                        {#each apiSurfaces as surface (surfaceKey(surface))}
                          {@const key = surfaceKey(surface)}
                          {@const digest = catalogDigestForContractId(surface.contractId)}
                          {@const panels = selectedSurfaceKey === key ? schemaPanelsForSurface(surface) : []}
                          <tr class="cursor-pointer hover:bg-base-200/60" onclick={() => toggleSurface(surface)}>
                            {#if activeTab === "operations"}<td>{surfaceLabel(surface.kind)}</td>{/if}
                            <td class="trellis-identifier font-medium">{surface.name}</td>
                            <td><span class="badge badge-outline badge-xs">{surface.action}</span></td>
                            <td>{surface.required ? "Required" : "Optional"}</td>
                            <td class="trellis-identifier text-base-content/60">{surface.contractId}</td>
                          </tr>
                          {#if selectedSurfaceKey === key}
                            <tr>
                              <td colspan={activeTab === "operations" ? 5 : 4}>
                                <div class="rounded-box border border-base-300 bg-base-200/40 p-3">
                                  {#if !digest}
                                    <p class="text-xs text-base-content/60">No catalog digest is available for this contract.</p>
                                  {:else if contractDetailLoading.includes(digest)}
                                    <LoadingState label="Loading contract schemas" />
                                  {:else if contractDetailErrors[digest]}
                                    <p class="text-xs text-error">{contractDetailErrors[digest]}</p>
                                  {:else if panels.length === 0}
                                    <p class="text-xs text-base-content/60">No schema details were found for this surface.</p>
                                  {:else}
                                    <div class="grid gap-3 lg:grid-cols-2">
                                      {#each panels as panel (panel.label)}
                                        <div>
                                          <div class="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-base-content/60">
                                            <span>{panel.label}</span>
                                            {#if panel.schemaName}<span class="trellis-identifier normal-case">{panel.schemaName}</span>{/if}
                                          </div>
                                          {#if panel.schema}
                                            <pre class="json-block">{#each jsonTokens(jsonString(panel.schema)) as token (token.key)}<span class={jsonTokenClass(token.kind)}>{token.text}</span>{/each}</pre>
                                            {#if panel.example !== null}
                                              <div class="mt-2 text-xs font-medium uppercase tracking-wide text-base-content/60">Example</div>
                                              <pre class="json-block mt-1">{#each jsonTokens(jsonString(panel.example)) as token (token.key)}<span class={jsonTokenClass(token.kind)}>{token.text}</span>{/each}</pre>
                                            {/if}
                                          {:else}
                                            <p class="text-xs text-base-content/60">No schema is declared.</p>
                                          {/if}
                                        </div>
                                      {/each}
                                    </div>
                                  {/if}
                                </div>
                              </td>
                            </tr>
                          {/if}
                        {:else}
                          <tr><td colspan={activeTab === "operations" ? 5 : 4} class="text-base-content/50">No {tabLabel(activeTab).toLowerCase()} surfaces.</td></tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                  {#if apiSurfaces.length > 0}
                    <p class="text-xs text-base-content/50">Click a surface row to inspect schemas from its contract manifest.</p>
                  {/if}
                </div>
              {/if}
            {:else if activeTab === "schemas"}
              {#if selectedServiceContractRefs.length === 0}
                <EmptyState title="No service contract" description="No current contract digest is available for this deployment's instances." />
              {:else if selectedServiceContractRefs.some((ref) => contractDetailLoading.includes(splitContractRef(ref).digest))}
                <LoadingState label="Loading service schemas" />
              {:else if selectedSchemaRows.length === 0}
                <EmptyState title="No additional exported schemas" description="No exported schemas outside the RPC, event, and operation surfaces were found." />
              {:else}
                <div class="space-y-3">
                  {#each selectedSchemaRows as row (row.key)}
                    <div class="rounded-box border border-base-300 bg-base-200/30 p-3">
                      <div class="mb-2 flex flex-wrap items-center gap-2">
                        <span class="trellis-identifier font-medium">{row.name}</span>
                        <span class="badge badge-outline badge-xs trellis-identifier">{row.contractId}</span>
                      </div>
                      <pre class="json-block">{#each jsonTokens(jsonString(row.schema)) as token (token.key)}<span class={jsonTokenClass(token.kind)}>{token.text}</span>{/each}</pre>
                    </div>
                  {/each}
                </div>
              {/if}
            {:else if activeTab === "resources"}
              {#if !selectedEnvelope}
                <EmptyState title="No resources" description="No current service envelope was returned for this deployment." />
              {:else}
                <div class="overflow-x-auto">
                  <table class="table table-sm trellis-table">
                    <thead><tr><th>Alias</th><th>Kind</th><th>Requirement</th></tr></thead>
                    <tbody>{#each selectedEnvelope.boundary.resources as resource (`${resource.kind}:${resource.alias}`)}<tr><td class="trellis-identifier font-medium">{resource.alias}</td><td>{resource.kind}</td><td>{resource.required ? "Required" : "Optional"}</td></tr>{:else}<tr><td colspan="3" class="text-base-content/50">No resources.</td></tr>{/each}</tbody>
                  </table>
                </div>
              {/if}
            {:else if activeTab === "capabilities"}
              {#if !selectedEnvelope}
                <EmptyState title="No capabilities" description="No current service envelope was returned for this deployment." />
              {:else}
                {@const capabilities = capabilityRows(selectedEnvelope, selectedInstances)}
                <div class="overflow-x-auto">
                  <table class="table table-sm trellis-table">
                    <thead><tr><th>Capability</th><th>Source</th><th>Context</th></tr></thead>
                    <tbody>{#each capabilities as capability (`${capability.source}:${capability.context}:${capability.capability}`)}<tr><td class="trellis-identifier font-medium">{capability.capability}</td><td>{capability.source}</td><td class="trellis-identifier text-base-content/60">{capability.context}</td></tr>{:else}<tr><td colspan="3" class="text-base-content/50">No capabilities.</td></tr>{/each}</tbody>
                  </table>
                </div>
              {/if}
            {:else if activeTab === "dependencies"}
              {#if !selectedEnvelope}
                <EmptyState title="No dependencies" description="No current service envelope was returned for this deployment." />
              {:else}
                <div class="overflow-x-auto">
                  <table class="table table-sm trellis-table">
                    <thead><tr><th>Contract</th><th>Requirement</th><th>Implementing services</th></tr></thead>
                    <tbody>{#each selectedEnvelope.boundary.contracts as contract (contract.contractId)}{@const implementers = serviceDeploymentsForContract(contract.contractId)}<tr><td class="trellis-identifier font-medium">{contract.contractId}</td><td>{contract.required ? "Required" : "Optional"}</td><td><div class="flex flex-wrap gap-1">{#each implementers as implementer (implementer.deploymentId)}<button type="button" class="btn btn-ghost btn-xs trellis-identifier" onclick={() => selectDeployment(implementer.deploymentId)}>{implementer.deploymentId}</button>{:else}<span class="text-xs text-base-content/50">No service deployment found</span>{/each}</div></td></tr>{:else}<tr><td colspan="3" class="text-base-content/50">No contract dependencies.</td></tr>{/each}</tbody>
                  </table>
                </div>
              {/if}
            {:else if activeTab === "jobs"}
              {#if jobsUnavailableMessage}
                <div class="alert alert-info"><span>{jobsUnavailableMessage}</span></div>
              {:else if selectedJobs.length === 0}
                <EmptyState title="No jobs" description="No jobs are currently associated with this deployment." />
              {:else}
                <div class="overflow-x-auto">
                  <table class="table table-sm trellis-table">
                    <thead><tr><th>Service</th><th>Type</th><th>State</th><th>Updated</th></tr></thead>
                    <tbody>
                      {#each selectedJobs as job (`${job.service}:${job.type}:${job.id}`)}
                        <tr><td class="trellis-identifier">{job.service}</td><td class="trellis-identifier text-base-content/60">{job.type}</td><td><StatusBadge label={job.state} status={statusForJob(job.state)} /></td><td class="text-base-content/60">{formatDate(job.updatedAt)}</td></tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            {:else if selectedEvents.length === 0}
              <EmptyState title="No heartbeat events" description="No live heartbeat events have been received for this deployment yet." />
            {:else}
              <div class="space-y-3">
                {#each selectedEvents as event (event.id)}
                  <div class="rounded-box border border-base-300 bg-base-200/40 p-3"><div class="mb-2 flex items-start justify-between gap-2"><div><div class="font-medium text-sm">{event.heartbeat.service.name}</div><div class="trellis-identifier text-base-content/50">{event.heartbeat.service.instanceId}</div></div><StatusBadge label={statusLabel(event.heartbeat.status)} status={event.heartbeat.status} /></div><div class="text-xs text-base-content/60">published {formatDate(event.heartbeat.header.time)} · received {formatSeenAt(event.receivedAt)}</div><pre class="mt-2 overflow-x-auto rounded bg-base-100 p-2 text-[11px] leading-5 text-base-content/80">{JSON.stringify(event.heartbeat, null, 2)}</pre></div>
                {/each}
              </div>
            {/if}
            </div>
          </Panel>
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .json-block {
    overflow-x: auto;
    border-radius: var(--radius-box);
    background: color-mix(in oklab, var(--color-base-100) 88%, var(--color-base-content));
    padding: 0.75rem;
    font-size: 0.72rem;
    line-height: 1.45;
    color: color-mix(in oklab, var(--color-base-content) 82%, transparent);
  }

  .json-block :global(.json-key) {
    color: var(--color-info);
  }

  .json-block :global(.json-string) {
    color: var(--color-success);
  }

  .json-block :global(.json-number),
  .json-block :global(.json-boolean) {
    color: var(--color-warning);
  }

  .json-block :global(.json-null) {
    color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  }
</style>

<ConfirmationModal bind:this={confirmationModal} />
