<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthGetInstalledContractOutput,
    AuthListInstalledContractsOutput,
    AuthListServiceDeploymentsOutput,
    AuthListServiceInstancesOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { replaceState } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import {
    getAppliedApiCatalogRows,
    type AppliedApiCatalogKind,
    type AppliedApiCatalogRow,
  } from "$lib/applied_api_discovery";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  const trellis = getTrellis();

  type ContractSummary = AuthListInstalledContractsOutput["contracts"][number];
  type ContractDetail = AuthGetInstalledContractOutput["contract"];
  type JsonPrimitive = string | number | boolean | null;
  type JsonLike = JsonPrimitive | JsonLike[] | { [key: string]: JsonLike };
  type SchemaReference = { label: string; name: string };
  type SchemaReferenceDetail = SchemaReference & {
    example: JsonLike;
    exampleTokens: JsonToken[];
    schemaTokens: JsonToken[];
  };
  type JsonTokenKind = "punctuation" | "key" | "string" | "number" | "boolean" | "null" | "whitespace";
  type JsonToken = { id: string; value: string; kind: JsonTokenKind };
  type CapabilityGroup = {
    key: "callCapabilities" | "readCapabilities" | "publishCapabilities" | "subscribeCapabilities";
    label: string;
  };
  type ActivityState = "active" | "inactive";

  const defaultSelectedKinds: AppliedApiCatalogKind[] = ["rpc", "operation", "event"];
  const defaultSelectedActivityStates: ActivityState[] = ["active"];
  const kindOptions: { value: AppliedApiCatalogKind; label: string }[] = [
    { value: "rpc", label: "RPC" },
    { value: "operation", label: "Operations" },
    { value: "event", label: "Events" },
    { value: "schema", label: "Schemas" },
  ];
  const activityOptions: { value: ActivityState; label: string }[] = [
    { value: "active", label: "Active" },
    { value: "inactive", label: "Inactive" },
  ];

  const capabilityGroups: CapabilityGroup[] = [
    { key: "callCapabilities", label: "Call" },
    { key: "readCapabilities", label: "Read" },
    { key: "publishCapabilities", label: "Publish" },
    { key: "subscribeCapabilities", label: "Subscribe" },
  ];

  let loading = $state(true);
  let error = $state<string | null>(null);
  let search = $state("");
  let selectedKinds = $state.raw<AppliedApiCatalogKind[]>(defaultSelectedKinds);
  let selectedActivityStates = $state.raw<ActivityState[]>(defaultSelectedActivityStates);
  let selectedServiceIds = $state.raw<string[]>([]);
  let installedContracts = $state.raw<ContractSummary[]>([]);
  let deployments = $state.raw<AuthListServiceDeploymentsOutput["deployments"]>([]);
  let instances = $state.raw<AuthListServiceInstancesOutput["instances"]>([]);
  let contractDetails = $state.raw<ContractDetail[]>([]);
  let selectedRowId = $state<string | null>(page.url.searchParams.get("api"));

  const rows = $derived(getAppliedApiCatalogRows({ deployments }, { instances }, contractDetails));
  const serviceOptions: string[] = $derived.by(() => {
    const providerDeploymentIds = rows.flatMap((row) => row.providerDeploymentIds);
    return Array.from(new Set<string>(providerDeploymentIds)).sort((a, b) => a.localeCompare(b));
  });
  const selectedServiceIdSet = $derived(new Set(selectedServiceIds));
  const selectedKindSet = $derived(new Set<AppliedApiCatalogKind>(selectedKinds));
  const selectedActivityStateSet = $derived(new Set<ActivityState>(selectedActivityStates));
  const filteredRows = $derived.by(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!selectedKindSet.has(row.kind)) return false;
      if (selectedActivityStateSet.size === 0) return false;
      const activityState: ActivityState = row.activeInstances > 0 ? "active" : "inactive";
      if (!selectedActivityStateSet.has(activityState)) return false;
      if (
        selectedServiceIdSet.size > 0
        && !row.providerDeploymentIds.some((providerDeploymentId) => selectedServiceIdSet.has(providerDeploymentId))
      ) {
        return false;
      }
      if (!term) return true;
      const searchable = [
        row.name,
        row.contractId,
        row.contractDisplayName,
        row.subject,
        row.wildcardSubject,
        row.inputSchemaName,
        row.outputSchemaName,
        row.progressSchemaName,
        row.eventSchemaName,
        row.schemaName,
        row.description,
        row.documentation,
        ...row.providerDeploymentIds,
      ];
      return searchable.filter((value): value is string => Boolean(value)).some((value) =>
        value.toLowerCase().includes(term)
      );
    });
  });
  const selectedRow = $derived(
    rows.find((row) => row.id === selectedRowId) ?? filteredRows[0] ?? null,
  );

  function kindLabel(kind: AppliedApiCatalogKind): string {
    if (kind === "rpc") return "RPC";
    if (kind === "operation") return "Operation";
    if (kind === "event") return "Event";
    return "Schema";
  }

  function activityBadgeClass(activeInstances: number): string {
    return activeInstances > 0 ? "badge-success" : "badge-neutral";
  }

  function statusFilterLabel(): string {
    if (selectedActivityStates.length === 0) return "Status: None";
    if (selectedActivityStates.length === 1) {
      return `Status: ${activityOptions.find((option) => option.value === selectedActivityStates[0])?.label ?? "None"}`;
    }
    return `Status: ${selectedActivityStates.length}`;
  }

  function schemaReferences(row: AppliedApiCatalogRow): SchemaReference[] {
    return [
      { label: "Input", name: row.inputSchemaName ?? "" },
      { label: "Output", name: row.outputSchemaName ?? "" },
      { label: "Progress", name: row.progressSchemaName ?? "" },
      { label: "Event", name: row.eventSchemaName ?? "" },
      { label: "Schema", name: row.schemaName ?? "" },
    ].filter((entry) => entry.name.length > 0);
  }

  function schemaJson(row: AppliedApiCatalogRow): string | null {
    if (row.schema === undefined) return null;
    return JSON.stringify(row.schema, null, 2);
  }

  function jsonLikeTokens(value: JsonLike): JsonToken[] {
    return jsonTokens(JSON.stringify(value, null, 2));
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function schemaStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  }

  function schemaExample(schema: unknown, depth = 0): JsonLike {
    if (depth > 5) return null;
    if (schema === true) return "value";
    if (schema === false || schema === null || schema === undefined) return null;
    if (!isRecord(schema)) return null;

    if ("const" in schema) return toJsonLike(schema.const);
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return toJsonLike(schema.enum[0]);
    if (Array.isArray(schema.examples) && schema.examples.length > 0) return toJsonLike(schema.examples[0]);

    const types = typeof schema.type === "string" ? [schema.type] : schemaStringArray(schema.type);
    const primaryType = types.find((type) => type !== "null") ?? types[0];

    if (primaryType === "object" || (primaryType === undefined && isRecord(schema.properties))) {
      const properties = isRecord(schema.properties) ? schema.properties : {};
      const example: { [key: string]: JsonLike } = {};
      for (const [key, propertySchema] of Object.entries(properties)) {
        example[key] = schemaExample(propertySchema, depth + 1);
      }
      return example;
    }

    if (primaryType === "array") return [schemaExample(schema.items, depth + 1)];
    if (primaryType === "string") return "string";
    if (primaryType === "integer") return 1;
    if (primaryType === "number") return 1.23;
    if (primaryType === "boolean") return true;
    if (primaryType === "null") return null;

    if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) return schemaExample(schema.oneOf[0], depth + 1);
    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) return schemaExample(schema.anyOf[0], depth + 1);
    if (Array.isArray(schema.allOf) && schema.allOf.length > 0) return schemaExample(schema.allOf[0], depth + 1);

    return null;
  }

  function toJsonLike(value: unknown): JsonLike {
    if (value === null) return null;
    if (typeof value === "string") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map((entry) => toJsonLike(entry));
    if (!isRecord(value)) return null;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toJsonLike(entry)]));
  }

  function jsonTokens(json: string): JsonToken[] {
    const tokens: JsonToken[] = [];
    const pattern = /\s+|"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\]:,]/g;
    for (const match of json.matchAll(pattern)) {
      const value = match[0];
      const id = `${match.index ?? tokens.length}:${value}`;
      let kind: JsonTokenKind = "punctuation";
      if (/^\s+$/.test(value)) kind = "whitespace";
      else if (value.startsWith('"') && json.slice((match.index ?? 0) + value.length).trimStart().startsWith(":")) kind = "key";
      else if (value.startsWith('"')) kind = "string";
      else if (value === "true" || value === "false") kind = "boolean";
      else if (value === "null") kind = "null";
      else if (/^-?\d/.test(value)) kind = "number";
      tokens.push({ id, value, kind });
    }
    return tokens;
  }

  function tokenClass(kind: JsonTokenKind): string {
    if (kind === "key") return "text-info";
    if (kind === "string") return "text-success";
    if (kind === "number") return "text-warning";
    if (kind === "boolean") return "text-secondary";
    if (kind === "null") return "text-base-content/45";
    if (kind === "punctuation") return "text-base-content/60";
    return "";
  }

  function resolveSchemaReference(row: AppliedApiCatalogRow, reference: SchemaReference): AppliedApiCatalogRow | null {
    if (reference.label === "Schema" && row.schemaName === reference.name && row.schema !== undefined) return row;
    return rows.find((candidate) =>
      candidate.kind === "schema" && candidate.digest === row.digest && candidate.schemaName === reference.name
    ) ?? null;
  }

  function schemaReferenceDetails(row: AppliedApiCatalogRow): SchemaReferenceDetail[] {
    return schemaReferences(row).flatMap((reference) => {
      const resolved = resolveSchemaReference(row, reference);
      const json = resolved ? schemaJson(resolved) : null;
      const example = resolved ? schemaExample(resolved.schema) : null;
      return resolved && json
        ? [{ ...reference, example, exampleTokens: jsonLikeTokens(example), schemaTokens: jsonTokens(json) }]
        : [];
    });
  }

  function normalizeCopy(value: string | undefined): string {
    return value?.replace(/\s+/g, " ").trim() ?? "";
  }

  function showContractDescription(row: AppliedApiCatalogRow): boolean {
    const contractDescription = normalizeCopy(row.contractDescription);
    if (!contractDescription) return false;
    return contractDescription !== normalizeCopy(row.description) && contractDescription !== normalizeCopy(row.documentation);
  }

  function selectRow(row: AppliedApiCatalogRow) {
    selectedRowId = row.id;
    const url = new URL(page.url);
    url.searchParams.set("api", row.id);
    replaceState(resolve(...([`${url.pathname}${url.search}${url.hash}`] as never)), page.state);
  }

  function toggleKind(kind: AppliedApiCatalogKind) {
    selectedKinds = selectedKindSet.has(kind)
      ? selectedKinds.filter((selectedKind) => selectedKind !== kind)
      : [...selectedKinds, kind];
  }

  function resetKinds() {
    selectedKinds = defaultSelectedKinds;
  }

  function toggleActivityState(activityState: ActivityState) {
    selectedActivityStates = selectedActivityStateSet.has(activityState)
      ? selectedActivityStates.filter((selectedActivityState) => selectedActivityState !== activityState)
      : [...selectedActivityStates, activityState];
  }

  function resetActivityStates() {
    selectedActivityStates = defaultSelectedActivityStates;
  }

  function toggleService(serviceId: string) {
    selectedServiceIds = selectedServiceIdSet.has(serviceId)
      ? selectedServiceIds.filter((selectedServiceId) => selectedServiceId !== serviceId)
      : [...selectedServiceIds, serviceId];
  }

  function clearServices() {
    selectedServiceIds = [];
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [deploymentsRes, instancesRes, contractsRes] = await Promise.all([
        trellis.request("Auth.ListServiceDeployments", {}).take(),
        trellis.request("Auth.ListServiceInstances", {}).take(),
        trellis.request("Auth.ListInstalledContracts", {}).take(),
      ]);

      if (isErr(deploymentsRes)) { error = errorMessage(deploymentsRes); return; }
      if (isErr(instancesRes)) { error = errorMessage(instancesRes); return; }
      if (isErr(contractsRes)) { error = errorMessage(contractsRes); return; }

      const nextInstalledContracts = contractsRes.contracts ?? [];
      const details = await Promise.all(nextInstalledContracts.map(async (contract) => {
        const detailRes = await trellis.request("Auth.GetInstalledContract", { digest: contract.digest }).take();
        if (isErr(detailRes)) {
          throw new Error(`Failed to load contract ${contract.digest}: ${errorMessage(detailRes)}`);
        }
        return detailRes.contract;
      }));

      deployments = deploymentsRes.deployments ?? [];
      instances = instancesRes.instances ?? [];
      installedContracts = nextInstalledContracts;
      contractDetails = details;
    } catch (loadError) {
      error = errorMessage(loadError);
    } finally {
      loading = false;
    }
  }

  onMount(() => { void load(); });
</script>

<section class="space-y-4 xl:flex xl:h-[calc(100vh-7.5rem)] xl:min-h-0 xl:flex-col xl:overflow-hidden xl:space-y-0">
  <PageToolbar title="API Catalog" description="Production endpoints and schemas discovered from installed contracts.">
    {#snippet actions()}
      <label class="sr-only" for="api-search">Search APIs</label>
      <input id="api-search" class="input input-bordered input-sm w-72" placeholder="Search APIs…" bind:value={search} />
      <div class="dropdown dropdown-end">
        <button class="btn btn-outline btn-sm" type="button">
          Kinds: {selectedKinds.length === 0 ? "None" : selectedKinds.length}
        </button>
        <div class="dropdown-content z-[1] mt-2 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow">
          <div class="mb-1 px-2 text-[0.68rem] font-semibold uppercase text-base-content/50">Kinds</div>
          {#each kindOptions as option (option.value)}
            <label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-base-200">
              <input
                class="checkbox checkbox-sm"
                type="checkbox"
                checked={selectedKindSet.has(option.value)}
                onchange={() => toggleKind(option.value)}
              />
              <span>{option.label}</span>
            </label>
          {/each}
          <div class="mt-2 border-t border-base-300 pt-2">
            <button class="btn btn-ghost btn-xs w-full" type="button" onclick={resetKinds}>Default kinds</button>
          </div>
        </div>
      </div>
      <div class="dropdown dropdown-end">
        <button class="btn btn-outline btn-sm" type="button">
          {statusFilterLabel()}
        </button>
        <div class="dropdown-content z-[1] mt-2 w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow">
          <div class="mb-1 px-2 text-[0.68rem] font-semibold uppercase text-base-content/50">Status</div>
          {#each activityOptions as option (option.value)}
            <label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-base-200">
              <input
                class="checkbox checkbox-sm"
                type="checkbox"
                checked={selectedActivityStateSet.has(option.value)}
                onchange={() => toggleActivityState(option.value)}
              />
              <span>{option.label}</span>
            </label>
          {/each}
          <div class="mt-2 border-t border-base-300 pt-2">
            <button class="btn btn-ghost btn-xs w-full" type="button" onclick={resetActivityStates}>Default status</button>
          </div>
        </div>
      </div>
      <div class="dropdown dropdown-end">
        <button class="btn btn-outline btn-sm max-w-44 truncate" type="button" disabled={serviceOptions.length === 0}>
          Services: {selectedServiceIds.length === 0 ? "All" : selectedServiceIds.length}
        </button>
        <div class="dropdown-content z-[1] mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-box border border-base-300 bg-base-100 p-2 shadow">
          <div class="mb-1 px-2 text-[0.68rem] font-semibold uppercase text-base-content/50">Deployments</div>
          <div class="max-h-64 overflow-y-auto">
            {#each serviceOptions as serviceId (serviceId)}
              <label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-base-200">
                <input
                  class="checkbox checkbox-sm"
                  type="checkbox"
                  checked={selectedServiceIdSet.has(serviceId)}
                  onchange={() => toggleService(serviceId)}
                />
                <span class="trellis-identifier min-w-0 truncate">{serviceId}</span>
              </label>
            {/each}
          </div>
          {#if selectedServiceIds.length > 0}
            <div class="mt-2 border-t border-base-300 pt-2">
              <button class="btn btn-ghost btn-xs w-full" type="button" onclick={clearServices}>Clear services</button>
            </div>
          {/if}
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <LoadingState label="Loading API catalog" />
  {:else if installedContracts.length === 0}
    <EmptyState title="No installed contracts" description="Install contracts before browsing production API surfaces." />
  {:else if rows.length === 0}
    <EmptyState title="No API rows found" description="Installed contracts did not expose discoverable endpoints or schemas." />
  {:else}
    <div class="grid grid-cols-1 gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1.65fr)] xl:overflow-hidden">
      <Panel class="min-w-0 xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden xl:[&>.card-body]:min-h-0 xl:[&>.card-body]:flex-1 xl:[&>.card-body]:overflow-hidden">
        {#if filteredRows.length === 0}
          <EmptyState title="No matches" description="Adjust search, kind, service, or status filters." class="min-h-40" />
        {:else}
          <div class="max-w-full overflow-hidden rounded-box border border-base-300 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
            <div class="max-h-[calc(100vh-18rem)] max-w-full space-y-1 overflow-x-hidden overflow-y-auto p-1 xl:max-h-none xl:flex-1">
              {#each filteredRows as row (row.id)}
                <button
                  class={[
                    "block w-full max-w-full overflow-hidden rounded px-3 py-2 text-left transition-colors hover:bg-base-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-base-100",
                    selectedRow?.id === row.id && "bg-base-200",
                  ]}
                  onclick={() => selectRow(row)}
                  aria-current={selectedRow?.id === row.id ? "true" : undefined}
                  aria-label={`Select ${kindLabel(row.kind)} ${row.title ?? row.name}`}
                >
                  <div class="min-w-0 space-y-1.5">
                    <div class="flex min-w-0 items-start gap-2">
                      <span class={["badge badge-xs shrink-0", activityBadgeClass(row.activeInstances)]}>{kindLabel(row.kind)}</span>
                      <div class="min-w-0 flex-1">
                        <div class="break-words text-xs font-medium">{row.title ?? row.name}</div>
                        <div class="trellis-identifier break-all text-[0.68rem] text-base-content/50">{row.name}</div>
                      </div>
                    </div>

                    <div class="trellis-identifier min-w-0 break-all text-[0.68rem] text-base-content/55">
                      {row.providerDeploymentIds.join(", ") || "No active provider"}
                    </div>
                  </div>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </Panel>

      <Panel class="min-w-0 xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden xl:[&>.card-body]:min-h-0 xl:[&>.card-body]:flex-1 xl:[&>.card-body]:overflow-y-auto">
        {#if !selectedRow}
          <EmptyState title="No selection" description="Select an endpoint or schema row to inspect details." class="min-h-40" />
        {:else}
          {@const selectedSchemaDetails = schemaReferenceDetails(selectedRow)}
          <div class="min-w-0 max-w-full space-y-5 pb-2 text-sm">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="mb-1 flex flex-wrap items-center gap-2">
                  <span class={["badge badge-xs", activityBadgeClass(selectedRow.activeInstances)]}>{kindLabel(selectedRow.kind)}</span>
                  <span class="badge badge-outline badge-xs">{selectedRow.activeInstances > 0 ? "Active" : "Inactive"}</span>
                  {#if selectedRow.exported !== undefined}
                    <span class="badge badge-outline badge-xs">{selectedRow.exported ? "Exported" : "Internal"}</span>
                  {/if}
                </div>
                <h3 class="break-words text-base font-semibold">{selectedRow.title ?? selectedRow.name}</h3>
                <details class="mt-1 min-w-0 max-w-full text-[0.72rem] text-base-content/55">
                  <summary class="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                    <span class="min-w-0 break-words">
                      {selectedRow.contractDisplayName || selectedRow.contractId}
                      <span class="trellis-identifier break-all">({selectedRow.contractId})</span>
                    </span>
                    <span class="ml-2 text-[0.68rem] font-medium text-primary hover:underline">metadata</span>
                  </summary>
                  <div class="mt-2 max-w-full rounded bg-base-200/45 p-2 text-[0.68rem]">
                    <div class="grid min-w-0 gap-1 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
                      <span class="text-base-content/45">Digest</span>
                      <span class="trellis-identifier min-w-0 break-all">{selectedRow.digest}</span>
                    </div>
                    {#if selectedRow.wildcardSubject}
                      <div class="mt-2 grid min-w-0 gap-1 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
                        <span class="text-base-content/45">Subject</span>
                        <span class="trellis-identifier min-w-0 break-all">{selectedRow.wildcardSubject}</span>
                      </div>
                    {/if}
                  </div>
                </details>
                <div class="trellis-identifier mt-1 min-w-0 break-all text-[0.72rem] text-base-content/55">
                  Deployments: {selectedRow.providerDeploymentIds.join(", ") || "None"}
                </div>
              </div>
            </div>

            {#if capabilityGroups.some((group) => selectedRow[group.key].length > 0)}
              <section class="space-y-2">
                <h4 class="text-xs font-semibold uppercase tracking-wide text-base-content/50">Capabilities</h4>
                <div class="space-y-2">
                  {#each capabilityGroups as group (group.key)}
                    {#if selectedRow[group.key].length > 0}
                      <div>
                        <div class="mb-1 text-[0.68rem] font-semibold uppercase text-base-content/45">{group.label}</div>
                        <div class="flex min-w-0 flex-wrap gap-1">
                          {#each selectedRow[group.key] as capability (`${selectedRow.id}:${group.key}:${capability}`)}
                            <span class="badge badge-outline badge-xs trellis-identifier h-auto max-w-full whitespace-normal break-all leading-relaxed">{capability}</span>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  {/each}
                </div>
              </section>
            {/if}

            {#if selectedRow.description || selectedRow.documentation || selectedRow.contractDescription}
              <section class="space-y-2">
                <h4 class="text-[0.8rem] font-bold uppercase tracking-wide text-base-content/75">Documentation</h4>
                {#if selectedRow.description}
                  <p class="text-base-content/70">{selectedRow.description}</p>
                {/if}
                {#if selectedRow.documentation}
                  <p class="whitespace-pre-wrap text-base-content/60">{selectedRow.documentation}</p>
                {/if}
                {#if showContractDescription(selectedRow)}
                  <p class="text-xs text-base-content/50">Contract: {selectedRow.contractDescription}</p>
                {/if}
              </section>
            {/if}

            {#if schemaReferences(selectedRow).length > 0 && selectedSchemaDetails.length === 0}
              <p class="text-xs text-base-content/55">Schema references are present, but resolved schema JSON is not embedded for this selection.</p>
            {/if}

            {#if selectedSchemaDetails.length > 0}
              <div class="space-y-3">
                <h4 class="text-[0.8rem] font-bold uppercase tracking-wide text-base-content/75">Schemas</h4>
                <div class="grid min-w-0 gap-4 lg:grid-cols-2">
                  {#each selectedSchemaDetails as detail (`schema-detail:${selectedRow.id}:${detail.label}:${detail.name}`)}
                    <section class="min-w-0 space-y-3">
                      <div class="mb-3 min-w-0">
                        <div class="text-[0.68rem] font-semibold uppercase tracking-wide text-base-content/45">{detail.label}</div>
                        <div class="trellis-identifier mt-0.5 break-all text-xs font-semibold">{detail.name}</div>
                      </div>
                      <div class="min-w-0 space-y-3">
                        <div class="min-w-0">
                          <div class="mb-1 text-[0.68rem] font-semibold uppercase tracking-wide text-base-content/45">Example</div>
                          <pre class="h-44 max-w-full overflow-auto whitespace-pre rounded bg-base-200/45 p-2 text-xs leading-relaxed"><code>{#each detail.exampleTokens as token (token.id)}<span class={tokenClass(token.kind)}>{token.value}</span>{/each}</code></pre>
                        </div>
                        <details open class="min-w-0">
                          <summary class="cursor-pointer select-none text-[0.68rem] font-semibold uppercase tracking-wide text-base-content/60">Resolved schema JSON</summary>
                          <pre class="mt-2 h-[28rem] max-w-full overflow-auto whitespace-pre rounded bg-base-200/45 p-2 text-xs leading-relaxed"><code>{#each detail.schemaTokens as token (token.id)}<span class={tokenClass(token.kind)}>{token.value}</span>{/each}</code></pre>
                        </details>
                      </div>
                    </section>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </Panel>
    </div>
  {/if}
</section>
