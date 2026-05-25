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
  import DataTable from "$lib/components/DataTable.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { boundaryCounts } from "$lib/envelope_console";
  import {
    contractDependencyBlockLabel,
    contractDependencyProviderContract,
    contractDependencyRequiredThing,
    isContractDependencyBlock,
    isForcedUpdateRepair,
    parseContractDependencyBlock,
  } from "$lib/catalog_issues";
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
  type ContractCompatibilityMode = "strict" | "mutable-dev";
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
  type ContractDocs = {
    summary?: string;
    markdown: string;
  };
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
  type DependencyThing = {
    kind: string;
    name: string;
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
  type Tab = "instances" | "rpc" | "events" | "operations" | "feeds" | "schemas" | "resources" | "capabilities" | "dependencies" | "jobs" | "heartbeats";
  type SurfaceGroup = {
    key: string;
    contractId: string;
    kind: Surface["kind"];
    name: string;
    actions: string[];
    required: "required" | "optional" | "mixed";
    representative: Surface;
    surfaces: Surface[];
  };
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

  const tabs: Tab[] = ["instances", "rpc", "events", "operations", "feeds", "schemas", "resources", "capabilities", "dependencies", "jobs", "heartbeats"];

  const selectedDeployment = $derived(deployments.find((deployment) => deployment.deploymentId === selectedDeploymentId) ?? null);
  const serviceDeploymentIds = $derived.by(() => new Set(deployments.map((deployment) => deployment.deploymentId)));
  const selectedInstances = $derived(instances.filter((instance) => instance.deploymentId === selectedDeploymentId));
  const activeInstances = $derived(selectedInstances.filter((instance) => !instance.disabled));
  const selectedInstanceIds = $derived(new Set(selectedInstances.map((instance) => instance.instanceId)));
  const selectedServiceContractIds = $derived(new Set(selectedInstances.map((instance) => instance.currentContractId).filter(isNonEmptyString)));
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
    if (activeInstances.length > 0) return { label: "Enabled", status: "offline" as const };
    return { label: "No instances", status: "offline" as const };
  });
  const dependencyBlocks = $derived(catalogIssues.filter(isContractDependencyBlock));
  const forcedUpdateRepairs = $derived(catalogIssues.filter(isForcedUpdateRepair));
  const selectedDeploymentDependencyBlocks = $derived(
    dependencyBlocks.filter((issue) => issue.deploymentIds.includes(selectedDeploymentId)),
  );
  const dependencySurfaceGroups = $derived.by(() => {
    if (!selectedEnvelope) return [];
    return groupSurfaces(selectedEnvelope.boundary.surfaces.filter((surface) => !selectedServiceContractIds.has(surface.contractId)));
  });
  const dependencyContracts = $derived(
    selectedEnvelope?.boundary.contracts.filter((contract) => !selectedServiceContractIds.has(contract.contractId)) ?? [],
  );

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

  function isNonEmptyString(value: string | undefined): value is string {
    return value !== undefined && value.trim().length > 0;
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

  function surfaceGroupKey(surface: Surface): string {
    return `${surface.contractId}:${surface.kind}:${surface.name}`;
  }

  function groupSurfaces(surfaces: readonly Surface[]): SurfaceGroup[] {
    const groups: SurfaceGroup[] = [];
    for (const surface of surfaces) {
      const key = surfaceGroupKey(surface);
      const group = groups.find((entry) => entry.key === key);
      if (group) {
        const nextSurfaces = [...group.surfaces, surface];
        group.surfaces = nextSurfaces;
        if (!group.actions.includes(surface.action)) group.actions = [...group.actions, surface.action];
        group.required = requirementForSurfaces(nextSurfaces);
      } else {
        groups.push({
          key,
          contractId: surface.contractId,
          kind: surface.kind,
          name: surface.name,
          actions: [surface.action],
          required: surface.required ? "required" : "optional",
          representative: surface,
          surfaces: [surface],
        });
      }
    }
    return groups;
  }

  function requirementForSurfaces(surfaces: readonly Surface[]): SurfaceGroup["required"] {
    const required = surfaces.some((surface) => surface.required);
    const optional = surfaces.some((surface) => !surface.required);
    if (required && optional) return "mixed";
    return required ? "required" : "optional";
  }

  function requirementLabel(requirement: SurfaceGroup["required"]): string {
    if (requirement === "mixed") return "Mixed";
    return requirement === "required" ? "Required" : "Optional";
  }

  function actionLabel(kind: Surface["kind"], action: string): string {
    if (kind === "operation" && action === "call") return "Start";
    if (kind === "operation" && action === "observe") return "Observe";
    if (kind === "feed" && action === "subscribe") return "Subscribe";
    if (action === "call") return "Call";
    if (action === "publish") return "Publish";
    if (action === "subscribe") return "Subscribe";
    if (action === "cancel") return "Cancel";
    return action[0]?.toUpperCase() + action.slice(1);
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

  function contractDocs(value: unknown): ContractDocs | null {
    const record = objectRecord(value);
    const markdown = record?.markdown;
    if (typeof markdown !== "string" || markdown.trim().length === 0) return null;
    const summary = record?.summary;
    return typeof summary === "string" && summary.trim().length > 0 ? { summary, markdown } : { markdown };
  }

  function contractSurfaceDescriptor(contract: ContractDetail, kind: Surface["kind"], name: string): Record<string, unknown> | null {
    if (kind === "rpc") return objectRecord(objectRecord(contract.rpc)?.[name]);
    if (kind === "event") return objectRecord(objectRecord(contract.events)?.[name]);
    if (kind === "operation") return objectRecord(objectRecord(contract.operations)?.[name]);
    return objectRecord(objectRecord(objectRecord(contract)?.feeds)?.[name]);
  }

  function docsForSurface(surface: Surface): ContractDocs | null {
    const digest = catalogDigestForContractId(surface.contractId);
    const contract = digest ? contractDetails[digest] : null;
    if (!contract) return null;
    return contractDocs(contractSurfaceDescriptor(contract, surface.kind, surface.name)?.docs);
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
      const methodRecord = contractSurfaceDescriptor(contract, surface.kind, surface.name);
      const input = schemaFromRef(contract, methodRecord?.input);
      const output = schemaFromRef(contract, methodRecord?.output);
      return [
        { label: "Input", ...input, example: input.schema ? exampleFromSchema(input.schema) : null },
        { label: "Output", ...output, example: output.schema ? exampleFromSchema(output.schema) : null },
      ];
    }

    if (surface.kind === "event") {
      const event = contractSurfaceDescriptor(contract, surface.kind, surface.name);
      const eventSchema = schemaFromRef(contract, event?.event);
      return [{ label: "Event", ...eventSchema, example: eventSchema.schema ? exampleFromSchema(eventSchema.schema) : null }];
    }

    if (surface.kind === "operation") {
      const operationRecord = contractSurfaceDescriptor(contract, surface.kind, surface.name);
      const input = schemaFromRef(contract, operationRecord?.input);
      const output = schemaFromRef(contract, operationRecord?.output);
      const panels: SchemaPanel[] = [
        { label: "Input", ...input, example: input.schema ? exampleFromSchema(input.schema) : null },
        { label: "Output", ...output, example: output.schema ? exampleFromSchema(output.schema) : null },
      ];
      if (operationRecord?.progress !== undefined) {
        const progress = schemaFromRef(contract, operationRecord.progress);
        panels.push({ label: "Progress", ...progress, example: progress.schema ? exampleFromSchema(progress.schema) : null });
      }
      const signals = objectRecord(operationRecord?.signals);
      if (signals) {
        for (const [name, signal] of Object.entries(signals)) {
          const signalInput = schemaFromRef(contract, objectRecord(signal)?.input);
          panels.push({ label: `Signal: ${name}`, ...signalInput, example: signalInput.schema ? exampleFromSchema(signalInput.schema) : null });
        }
      }
      return panels;
    }

    if (surface.kind === "feed") {
      const feedRecord = contractSurfaceDescriptor(contract, surface.kind, surface.name);
      const input = schemaFromRef(contract, feedRecord?.input);
      const event = schemaFromRef(contract, feedRecord?.event);
      return [
        { label: "Input", ...input, example: input.schema ? exampleFromSchema(input.schema) : null },
        { label: "Event", ...event, example: event.schema ? exampleFromSchema(event.schema) : null },
      ];
    }

    return [];
  }

  function referencedSchemaNames(contract: ContractDetail): string[] {
    const names: string[] = [];
    for (const section of [contract.rpc, contract.events, contract.operations, objectRecord(contract)?.feeds]) {
      const records = objectRecord(section);
      if (!records) continue;
      for (const value of Object.values(records)) {
        const record = objectRecord(value);
        for (const key of ["input", "output", "event", "progress"] as const) {
          const name = schemaRefName(record?.[key]);
          if (name && !names.includes(name)) names.push(name);
        }
        const signals = objectRecord(record?.signals);
        if (signals) {
          for (const signal of Object.values(signals)) {
            const name = schemaRefName(objectRecord(signal)?.input);
            if (name && !names.includes(name)) names.push(name);
          }
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

  function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
  }

  function dependencyKindText(kind: string): string {
    return kind === "RPC" ? "RPC" : kind.toLowerCase();
  }

  function dependencyThingsFromBlockedContract(issue: CatalogIssue): DependencyThing[] {
    const digest = issue.digest;
    if (!digest) return [];
    const contract = contractDetails[digest];
    if (!contract) return [];
    const providerContract = contractDependencyProviderContract(issue);
    const uses = objectRecord(objectRecord(contract)?.uses);
    const groups = [objectRecord(uses?.required), objectRecord(uses?.optional)];
    const things: DependencyThing[] = [];
    for (const group of groups) {
      if (!group) continue;
      for (const useValue of Object.values(group)) {
        const use = objectRecord(useValue);
        if (use?.contract !== providerContract) continue;
        for (const name of stringList(objectRecord(use.rpc)?.call)) things.push({ kind: "RPC", name });
        for (const name of stringList(objectRecord(use.operations)?.call)) things.push({ kind: "Operation", name });
        const events = objectRecord(use.events);
        for (const name of stringList(events?.publish)) things.push({ kind: "Event", name });
        for (const name of stringList(events?.subscribe)) things.push({ kind: "Event", name });
        for (const name of stringList(objectRecord(use.feeds)?.subscribe)) things.push({ kind: "Feed", name });
      }
    }
    const seen: string[] = [];
    return things.filter((thing) => {
      const key = `${thing.kind}:${thing.name}`;
      if (seen.includes(key)) return false;
      seen.push(key);
      return true;
    });
  }

  function dependencyRequiredThing(issue: CatalogIssue): DependencyThing | null {
    const fromContract = dependencyThingsFromBlockedContract(issue)[0];
    if (fromContract) return fromContract;
    const detail = parseContractDependencyBlock(issue.message);
    return detail.surfaceKind && detail.surfaceName ? { kind: detail.surfaceKind, name: detail.surfaceName } : null;
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

  function escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderInlineMarkdown(value: string): string {
    return escapeHtml(value)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\s)\*([^*]+)\*(?=\s|$)/g, "$1<em>$2</em>");
  }

  function renderMarkdown(markdown: string): string {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const blocks: string[] = [];
    let paragraph: string[] = [];
    let list: string[] = [];
    let code: string[] | null = null;

    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (list.length === 0) return;
      blocks.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
      list = [];
    };

    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        if (code) {
          blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
          code = null;
        } else {
          flushParagraph();
          flushList();
          code = [];
        }
        continue;
      }
      if (code) {
        code.push(line);
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed) {
        flushParagraph();
        flushList();
        continue;
      }
      const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
      if (heading) {
        flushParagraph();
        flushList();
        const level = heading[1].length + 2;
        blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }
      const listItem = /^[-*]\s+(.+)$/.exec(trimmed);
      if (listItem) {
        flushParagraph();
        list.push(listItem[1]);
        continue;
      }
      flushList();
      paragraph.push(trimmed);
    }

    if (code) blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    flushParagraph();
    flushList();
    return blocks.join("\n");
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

  function surfacesForTab(tab: Tab): SurfaceGroup[] {
    if (!selectedEnvelope) return [];
    const providedSurfaces = selectedEnvelope.boundary.surfaces.filter((surface) => selectedServiceContractIds.has(surface.contractId));
    if (tab === "rpc") return groupSurfaces(providedSurfaces.filter((surface) => surface.kind === "rpc"));
    if (tab === "events") return groupSurfaces(providedSurfaces.filter((surface) => surface.kind === "event"));
    if (tab === "operations") return groupSurfaces(providedSurfaces.filter((surface) => surface.kind === "operation"));
    if (tab === "feeds") return groupSurfaces(providedSurfaces.filter((surface) => surface.kind === "feed"));
    return [];
  }

  function isApiTab(tab: Tab): boolean {
    return tab === "rpc" || tab === "events" || tab === "operations" || tab === "feeds";
  }

  function selectFirstSurfaceForTab(tab: Tab) {
    if (!isApiTab(tab)) return;
    const surfaces = surfacesForTab(tab);
    selectedSurfaceKey = surfaces.some((surface) => surface.key === selectedSurfaceKey) ? selectedSurfaceKey : surfaces[0]?.key ?? null;
    const surface = surfaces.find((entry) => entry.key === selectedSurfaceKey);
    if (surface) void ensureContractDetailForSurface(surface.representative);
  }

  function selectedSurfaceForGroups(groups: SurfaceGroup[]): SurfaceGroup | null {
    return groups.find((surface) => surface.key === selectedSurfaceKey) ?? groups[0] ?? null;
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

  function deploymentCompatibilityMode(deployment: Deployment): ContractCompatibilityMode {
    return objectRecord(deployment)?.contractCompatibilityMode === "mutable-dev" ? "mutable-dev" : "strict";
  }

  function compatibilityModeLabel(mode: ContractCompatibilityMode): string {
    return mode === "mutable-dev" ? "Mutable dev" : "Strict";
  }

  function compatibilityModeDescription(mode: ContractCompatibilityMode): string {
    return mode === "mutable-dev"
      ? "Development only; incompatible same-contract replacements are allowed when the envelope fits."
      : "Production default; incompatible same-contract digest replacements are rejected.";
  }

  function compatibilityModeBadgeClass(mode: ContractCompatibilityMode): string {
    return mode === "mutable-dev" ? "badge-warning" : "badge-outline";
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

  function selectDeployment(nextDeploymentId: string) {
    selectedDeploymentId = nextDeploymentId;
    selectedSurfaceKey = null;
    if (isApiTab(activeTab)) selectFirstSurfaceForTab(activeTab);
    if (isApiTab(activeTab) || activeTab === "schemas") void ensureSelectedServiceContractDetails();
    void ensureDependencyBlockDetailsForDeployment(nextDeploymentId);
  }

  function selectTab(tab: Tab) {
    activeTab = tab;
    if (isApiTab(tab)) selectFirstSurfaceForTab(tab);
    if (isApiTab(tab) || tab === "schemas") void ensureSelectedServiceContractDetails();
  }

  async function ensureSelectedServiceContractDetails() {
    await Promise.all(selectedServiceContractRefs.map((ref) => ensureContractDetailByDigest(splitContractRef(ref).digest)));
  }

  async function ensureDependencyBlockDetailsForDeployment(deploymentId: string) {
    await Promise.all(
      dependencyBlocks
        .filter((issue) => issue.deploymentIds.includes(deploymentId))
        .map((issue) => issue.digest)
        .filter((digest): digest is string => Boolean(digest))
        .map((digest) => ensureContractDetailByDigest(digest)),
    );
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

  function toggleSurface(group: SurfaceGroup) {
    selectedSurfaceKey = group.key;
    void ensureContractDetailForSurface(group.representative);
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
      void ensureDependencyBlockDetailsForDeployment(selectedDeploymentId);
      if (isApiTab(activeTab)) selectFirstSurfaceForTab(activeTab);
      if (isApiTab(activeTab) || activeTab === "schemas") void ensureSelectedServiceContractDetails();
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
        const result = await trellis.event.health.heartbeat.listen(handleHeartbeat, {}, {
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
    <Notice variant="error">{error}</Notice>
  {/if}
  {#if subscriptionError}
    <Notice variant="warning">Heartbeat subscription unavailable: {subscriptionError}</Notice>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading services" /></Panel>
  {:else}
    <div class="flex min-h-[calc(100vh-12rem)] min-w-0 flex-col gap-4">
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
            <thead><tr><th>Deployment</th><th>Status</th><th>Instances</th><th>Mode</th><th>Heartbeat</th><th>Jobs</th></tr></thead>
            <tbody>
              {#each filteredDeployments as deployment (deployment.deploymentId)}
                {@const serviceInstances = instances.filter((instance) => instance.deploymentId === deployment.deploymentId)}
                {@const activeServiceInstances = serviceInstances.filter((instance) => !instance.disabled)}
                {@const healthService = healthServiceForDeployment(deployment.deploymentId, serviceInstances, healthServices, contractRefDeploymentIds)}
                {@const rowStatus = deployment.disabled ? "Disabled" : (healthService ? statusLabel(healthService.status) : (activeServiceInstances.length > 0 ? "Enabled" : "No instances"))}
                {@const rowCompatibilityMode = deploymentCompatibilityMode(deployment)}
                {@const deploymentJobs = jobs.filter((job) => job.service === deployment.deploymentId)}
                <tr class={["hover:bg-base-200/60", selectedDeploymentId === deployment.deploymentId && "bg-base-200/70"]}>
                  <td class="min-w-72">
                    <button
                      type="button"
                      class="btn btn-ghost h-auto min-h-0 justify-start gap-2 px-2 py-1 text-left"
                      aria-current={selectedDeploymentId === deployment.deploymentId ? "true" : undefined}
                      onclick={() => selectDeployment(deployment.deploymentId)}
                    >
                      <span class={["h-2.5 w-2.5 rounded-full", dotClassForStatus(rowStatus)]}></span><span class="trellis-identifier font-medium">{deployment.deploymentId}</span>
                    </button>
                  </td>
                  <td><span class={["badge badge-sm", badgeClassForStatus(rowStatus)]}>{rowStatus}</span></td>
                  <td>{activeServiceInstances.length}/{serviceInstances.length} enabled</td>
                  <td>{#if rowCompatibilityMode === "mutable-dev"}<span class="badge badge-warning badge-xs">mutable-dev</span>{:else}<span class="badge badge-outline badge-xs">strict</span>{/if}</td>
                  <td class="text-base-content/60">{healthService ? formatSeenAt(healthService.lastSeenAt) : "—"}</td>
                  <td>{deploymentJobs.length}</td>
                </tr>
              {:else}
                <tr><td colspan="6" class="text-base-content/50">No matching deployments.</td></tr>
              {/each}
            </tbody>
          </DataTable>
        {/if}
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

        {#if dependencyBlocks.length > 0 || catalogIssueError}
          <div class="rounded-box border border-warning/30 bg-warning/10 px-4 py-2 text-sm">
            <div>
              {#if catalogIssueError}
                Catalog issue status unavailable: {catalogIssueError}
              {:else}
                <div><strong>{dependencyBlocks.length}</strong> contract dependency block{dependencyBlocks.length === 1 ? "" : "s"}. Select an affected deployment to inspect the missing dependency.</div>
              {/if}
              {#if !catalogIssueError}
              <div class="mt-2 flex flex-wrap gap-1">
                {#each dependencyBlocks.slice(0, 3) as issue (issue.issueId)}
                  {@const deploymentId = issue.deploymentIds.find((id) => deployments.some((deployment) => deployment.deploymentId === id))}
                  {#if deploymentId}
                    <button type="button" class="btn btn-warning btn-outline btn-xs trellis-identifier" onclick={() => selectDeployment(deploymentId)}>{deploymentId}</button>
                  {:else}
                    <span class="badge badge-outline badge-xs trellis-identifier">{contractDependencyBlockLabel(issue)}</span>
                  {/if}
                {/each}
              </div>
              {/if}
            </div>
          </div>
        {/if}

        {#if forcedUpdateRepairs.length > 0}
          <div class="rounded-box border border-error/30 bg-error/10 px-4 py-2 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span><strong>{forcedUpdateRepairs.length}</strong> forced contract update{forcedUpdateRepairs.length === 1 ? "" : "s"} need review</span>
              <a class="btn btn-error btn-outline btn-xs" href={resolve("/admin/services/repair")}>Open forced update</a>
            </div>
          </div>
        {/if}

        {#if !selectedDeployment}
          <Panel><EmptyState title="Select a deployment" description="Choose a deployment from the services table to inspect runtime state." /></Panel>
        {:else}
          {@const selectedCompatibilityMode = deploymentCompatibilityMode(selectedDeployment)}
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
              <span class="badge badge-outline badge-sm">{activeInstances.length}/{selectedInstances.length} enabled instances</span>
              <span
                class={[
                  "badge badge-sm",
                  compatibilityModeBadgeClass(selectedCompatibilityMode),
                ]}
                title={compatibilityModeDescription(selectedCompatibilityMode)}
              >Envelope mode: {compatibilityModeLabel(selectedCompatibilityMode)}</span>
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

            {#if selectedDeploymentDependencyBlocks.length > 0}
              {@const issue = selectedDeploymentDependencyBlocks[0]}
              {@const requiredThing = dependencyRequiredThing(issue)}
              {@const providerContract = contractDependencyProviderContract(issue)}
              {@const blockedContract = issue.contractId ?? selectedDeploymentId}
              <div class="mt-3 rounded-box border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
                <div class="font-medium">Contract dependency block</div>
                <div class="mt-1 text-xs text-base-content/70">
                  A <span class="trellis-identifier font-semibold">{selectedDeploymentId}</span> instance was blocked because its contract
                  {#if requiredThing}
                    requires an undefined {dependencyKindText(requiredThing.kind)} <span class="trellis-identifier font-semibold">{requiredThing.name}</span> from
                    <span class="trellis-identifier font-semibold">{providerContract}</span>. Please remove the undefined dependency from
                    <span class="trellis-identifier">{blockedContract}</span> or update <span class="trellis-identifier">{providerContract}</span> so that it properly offers it.
                  {:else}
                    requires <span class="trellis-identifier font-semibold">{providerContract}</span>, but that contract is not currently active or did not advertise the required API. Please remove the unsupported dependency from
                    <span class="trellis-identifier">{blockedContract}</span> or update <span class="trellis-identifier">{providerContract}</span>.
                  {/if}
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                  {#each selectedDeploymentDependencyBlocks.slice(0, 3) as issue (issue.issueId)}
                    <span class="badge badge-warning badge-outline badge-sm trellis-identifier">{contractDependencyBlockLabel(issue)}</span>
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
                <DataTable>
                    <thead><tr><th>Instance</th><th>Created</th><th>Heartbeat</th><th>Runtime</th><th>Actions</th></tr></thead>
                    <tbody>
                      {#each selectedInstances as instance (instance.instanceId)}
                        {@const heartbeat = healthInstanceForServiceInstance(instance)}
                        {@const runtimeLabel = heartbeat ? formatRuntime(heartbeat.runtime, heartbeat.runtimeVersion) : null}
                        <tr>
                          <td class="min-w-64"><div class="flex items-center gap-2"><span class="trellis-identifier font-medium">{instance.instanceId}</span>{#if instance.disabled}<StatusBadge label="Disabled" status="offline" />{:else}<StatusBadge label="Enabled" status="offline" />{/if}</div><div class="trellis-identifier text-xs text-base-content/50">{instance.instanceKey}</div></td>
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
                </DataTable>
              {/if}
            {:else if activeTab === "rpc" || activeTab === "events" || activeTab === "operations" || activeTab === "feeds"}
              {#if !selectedEnvelope}
                <EmptyState title="No API boundary" description="No current service envelope was returned for this deployment." />
              {:else}
                {@const apiSurfaces = surfacesForTab(activeTab)}
                {@const selectedApiSurface = selectedSurfaceForGroups(apiSurfaces)}
                <div class="space-y-2">
                  <div class="text-xs text-base-content/60">
                    <span class="font-medium">Offers:</span> Offered {tabLabel(activeTab).toLowerCase()} surfaces for this service. Actions are labeled from the consumer perspective.
                  </div>
                  {#if apiSurfaces.length === 0}
                    <DataTable><tbody><tr><td class="text-base-content/50">No {tabLabel(activeTab).toLowerCase()} surfaces.</td></tr></tbody></DataTable>
                  {:else if selectedApiSurface}
                    {@const digest = catalogDigestForContractId(selectedApiSurface.contractId)}
                    {@const docs = docsForSurface(selectedApiSurface.representative)}
                    {@const panels = schemaPanelsForSurface(selectedApiSurface.representative)}
                    <div class="grid gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
                      <div class="rounded-box border border-base-300 bg-base-200/30 p-2">
                        <div class="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-base-content/60">Surfaces</div>
                        <div class="space-y-1">
                          {#each apiSurfaces as surface (surface.key)}
                            <button type="button" class={["btn h-auto min-h-0 w-full justify-start px-2 py-2 text-left", selectedApiSurface.key === surface.key ? "btn-primary" : "btn-ghost"]} onclick={() => toggleSurface(surface)}>
                              <span class="min-w-0 flex-1">
                                <span class="trellis-identifier block truncate text-xs font-medium">{surface.name}</span>
                                <span class="mt-1 flex flex-wrap gap-1">
                                  {#each surface.actions as action (action)}<span class="badge badge-outline badge-xs">{actionLabel(surface.kind, action)}</span>{/each}
                                  <span class="badge badge-outline badge-xs">{requirementLabel(surface.required)}</span>
                                </span>
                              </span>
                            </button>
                          {/each}
                        </div>
                      </div>

                      <div class="rounded-box border border-base-300 bg-base-200/40 p-3">
                        <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
                          <div class="min-w-0">
                            <div class="trellis-identifier text-base font-semibold">{selectedApiSurface.name}</div>
                            <div class="trellis-identifier text-xs text-base-content/60">{selectedApiSurface.contractId}</div>
                            {#if digest}
                              <div class="trellis-identifier text-xs text-base-content/50">Digest {digest}</div>
                            {/if}
                          </div>
                          <div class="flex flex-wrap gap-1">
                            {#each selectedApiSurface.actions as action (action)}<span class="badge badge-outline badge-xs">{actionLabel(selectedApiSurface.kind, action)}</span>{/each}
                            <span class="badge badge-outline badge-xs">{requirementLabel(selectedApiSurface.required)}</span>
                          </div>
                        </div>

                        {#if !digest}
                          <p class="text-xs text-base-content/60">No catalog digest is available for this contract.</p>
                        {:else if contractDetailLoading.includes(digest)}
                          <LoadingState label="Loading contract schemas" />
                        {:else if contractDetailErrors[digest]}
                          <p class="text-xs text-error">{contractDetailErrors[digest]}</p>
                        {:else}
                          {#if docs}
                            <div class="mb-3 rounded-box border border-base-300 bg-base-100/70 p-3">
                              {#if docs.summary}
                                <div class="mb-2 text-sm font-medium">{docs.summary}</div>
                              {/if}
                              <div class="markdown-block">{@html renderMarkdown(docs.markdown)}</div>
                            </div>
                          {/if}
                          {#if panels.length === 0}
                            <p class="text-xs text-base-content/60">No schema details were found for this surface.</p>
                          {:else}
                            <div class="grid gap-3 xl:grid-cols-2">
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
                        {/if}
                      </div>
                    </div>
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
                <DataTable>
                    <thead><tr><th>Alias</th><th>Kind</th><th>Requirement</th></tr></thead>
                    <tbody>{#each selectedEnvelope.boundary.resources as resource (`${resource.kind}:${resource.alias}`)}<tr><td class="trellis-identifier font-medium">{resource.alias}</td><td>{resource.kind}</td><td>{resource.required ? "Required" : "Optional"}</td></tr>{:else}<tr><td colspan="3" class="text-base-content/50">No resources.</td></tr>{/each}</tbody>
                </DataTable>
              {/if}
            {:else if activeTab === "capabilities"}
              {#if !selectedEnvelope}
                <EmptyState title="No capabilities" description="No current service envelope was returned for this deployment." />
              {:else}
                {@const capabilities = capabilityRows(selectedEnvelope, selectedInstances)}
                <DataTable>
                    <thead><tr><th>Capability</th><th>Source</th><th>Context</th></tr></thead>
                    <tbody>{#each capabilities as capability (`${capability.source}:${capability.context}:${capability.capability}`)}<tr><td class="trellis-identifier font-medium">{capability.capability}</td><td>{capability.source}</td><td class="trellis-identifier text-base-content/60">{capability.context}</td></tr>{:else}<tr><td colspan="3" class="text-base-content/50">No capabilities.</td></tr>{/each}</tbody>
                </DataTable>
              {/if}
            {:else if activeTab === "dependencies"}
              {#if !selectedEnvelope}
                <EmptyState title="No dependencies" description="No current service envelope was returned for this deployment." />
              {:else}
                <div class="space-y-4">
                  <DataTable>
                      <thead><tr><th>Contract</th><th>Requirement</th><th>Implementing services</th></tr></thead>
                      <tbody>{#each dependencyContracts as contract (contract.contractId)}{@const implementers = serviceDeploymentsForContract(contract.contractId)}<tr><td class="trellis-identifier font-medium">{contract.contractId}</td><td>{contract.required ? "Required" : "Optional"}</td><td><div class="flex flex-wrap gap-1">{#each implementers as implementer (implementer.deploymentId)}<button type="button" class="btn btn-ghost btn-xs trellis-identifier" onclick={() => selectDeployment(implementer.deploymentId)}>{implementer.deploymentId}</button>{:else}<span class="text-xs text-base-content/50">No service deployment found</span>{/each}</div></td></tr>{:else}<tr><td colspan="3" class="text-base-content/50">No contract dependencies.</td></tr>{/each}</tbody>
                  </DataTable>

                  <DataTable>
                      <thead><tr><th>Surface</th><th>Type</th><th>Actions</th><th>Requirement</th><th>Contract</th></tr></thead>
                      <tbody>
                        {#each dependencySurfaceGroups as surface (surface.key)}
                          <tr>
                            <td class="trellis-identifier font-medium">{surface.name}</td>
                            <td>{surfaceLabel(surface.kind)}</td>
                            <td><div class="flex flex-wrap gap-1">{#each surface.actions as action (action)}<span class="badge badge-outline badge-xs">{actionLabel(surface.kind, action)}</span>{/each}</div></td>
                            <td>{requirementLabel(surface.required)}</td>
                            <td class="trellis-identifier text-base-content/60">{surface.contractId}</td>
                          </tr>
                        {:else}
                          <tr><td colspan="5" class="text-base-content/50">No dependency surfaces.</td></tr>
                        {/each}
                      </tbody>
                  </DataTable>
                </div>
              {/if}
            {:else if activeTab === "jobs"}
              {#if jobsUnavailableMessage}
                <Notice variant="info">{jobsUnavailableMessage}</Notice>
              {:else if selectedJobs.length === 0}
                <EmptyState title="No jobs" description="No jobs are currently associated with this deployment." />
              {:else}
                <DataTable>
                    <thead><tr><th>Service</th><th>Type</th><th>State</th><th>Updated</th></tr></thead>
                    <tbody>
                      {#each selectedJobs as job (`${job.service}:${job.type}:${job.id}`)}
                        <tr><td class="trellis-identifier">{job.service}</td><td class="trellis-identifier text-base-content/60">{job.type}</td><td><StatusBadge label={job.state} status={statusForJob(job.state)} /></td><td class="text-base-content/60">{formatDate(job.updatedAt)}</td></tr>
                      {/each}
                    </tbody>
                </DataTable>
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

  .markdown-block {
    border-radius: var(--radius-box);
    background: color-mix(in oklab, var(--color-base-100) 88%, var(--color-base-content));
    padding: 0.75rem;
    font-size: 0.78rem;
    line-height: 1.5;
    color: color-mix(in oklab, var(--color-base-content) 78%, transparent);
  }

  .markdown-block :global(p + p),
  .markdown-block :global(p + ul),
  .markdown-block :global(ul + p),
  .markdown-block :global(pre + p),
  .markdown-block :global(p + pre) {
    margin-top: 0.65rem;
  }

  .markdown-block :global(ul) {
    margin-left: 1rem;
    list-style: disc;
  }

  .markdown-block :global(h3),
  .markdown-block :global(h4),
  .markdown-block :global(h5) {
    margin-top: 0.75rem;
    font-weight: 600;
    color: var(--color-base-content);
  }

  .markdown-block :global(pre),
  .markdown-block :global(code) {
    border-radius: var(--radius-field);
    background: color-mix(in oklab, var(--color-base-100) 82%, var(--color-base-content));
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  }

  .markdown-block :global(pre) {
    overflow-x: auto;
    padding: 0.65rem;
    white-space: pre;
  }

  .markdown-block :global(code) {
    padding: 0.08rem 0.25rem;
  }

  .markdown-block :global(pre code) {
    padding: 0;
    background: transparent;
  }
</style>

<ConfirmationModal bind:this={confirmationModal} />
