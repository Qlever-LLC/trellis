<script lang="ts">
  import { isErr, type BaseError, type Result } from "@qlever-llc/result";
  import type { TrellisContractGetOutput } from "@qlever-llc/trellis/sdk/core";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "../../../../../../lib/format";
  import { getTrellis } from "../../../../../../lib/trellis";

  type ContractDetail = TrellisContractGetOutput["contract"];
  type ContractSchema = NonNullable<ContractDetail["schemas"]>[string];
  type ContractDocs = { summary?: string; markdown: string };
  type Tab = "docs" | "rpc" | "events" | "operations" | "feeds" | "schemas" | "capabilities";
  type SurfaceKind = "rpc" | "event" | "operation" | "feed";
  type SurfaceRow = {
    key: string;
    kind: SurfaceKind;
    name: string;
    descriptor: Record<string, unknown>;
  };
  type SchemaPanel = {
    label: string;
    schemaName: string | null;
    schema: ContractSchema | null;
    example: unknown | null;
  };
  type SchemaRow = {
    key: string;
    name: string;
    schema: ContractSchema;
  };
  type JsonTokenKind = "plain" | "key" | "string" | "number" | "boolean" | "null";
  type JsonToken = { key: string; kind: JsonTokenKind; text: string };
  type RpcTakeable<T> = { take(): Promise<T | Result<never, BaseError>> };
  type CoreRequest = {
    (method: "Trellis.Contract.Get", input: { digest: string }): RpcTakeable<TrellisContractGetOutput>;
  };

  const trellis = getTrellis();
  const coreRequest = trellis.request.bind(trellis) as CoreRequest;
  const tabs: Tab[] = ["docs", "rpc", "events", "operations", "feeds", "schemas", "capabilities"];

  let loading = $state(true);
  let error = $state<string | null>(null);
  let contract = $state.raw<ContractDetail | null>(null);
  let activeTab = $state<Tab>("docs");
  let selectedSurfaceKey = $state<string | null>(null);

  const digest = $derived(decodeURIComponent(page.url.pathname.split("/").filter(Boolean).at(-1) ?? ""));
  const topLevelDocs = $derived(contractDocs(objectRecord(contract)?.docs));
  const documentedSurfaces = $derived.by(() => contract ? collectSurfaceDocs(contract) : []);
  const activeSurfaces = $derived.by(() => contract ? surfacesForTab(contract, activeTab) : []);
  const selectedSurface = $derived(activeSurfaces.find((surface) => surface.key === selectedSurfaceKey) ?? activeSurfaces[0] ?? null);
  const selectedSurfaceDocs = $derived(selectedSurface ? contractDocs(selectedSurface.descriptor.docs) : null);
  const selectedSurfaceSchemaPanels = $derived(contract && selectedSurface ? schemaPanelsForSurface(contract, selectedSurface) : []);
  const exportedSchemaRows = $derived(contract ? schemaRows(contract) : []);
  const capabilityEntries = $derived(contract ? capabilityDefinitions(contract) : []);

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

  function contractSection(detail: ContractDetail, kind: SurfaceKind): Record<string, unknown> | null {
    if (kind === "rpc") return objectRecord(detail.rpc);
    if (kind === "event") return objectRecord(detail.events);
    if (kind === "operation") return objectRecord(detail.operations);
    return objectRecord(objectRecord(detail)?.feeds);
  }

  function surfaceRows(detail: ContractDetail, kind: SurfaceKind): SurfaceRow[] {
    const records = contractSection(detail, kind);
    if (!records) return [];
    return Object.entries(records).flatMap(([name, value]) => {
      const descriptor = objectRecord(value);
      return descriptor ? [{ key: `${kind}:${name}`, kind, name, descriptor }] : [];
    });
  }

  function surfacesForTab(detail: ContractDetail, tab: Tab): SurfaceRow[] {
    if (tab === "rpc") return surfaceRows(detail, "rpc");
    if (tab === "events") return surfaceRows(detail, "event");
    if (tab === "operations") return surfaceRows(detail, "operation");
    if (tab === "feeds") return surfaceRows(detail, "feed");
    return [];
  }

  function collectSurfaceDocs(detail: ContractDetail): Array<SurfaceRow & { docs: ContractDocs }> {
    return (["rpc", "event", "operation", "feed"] as const)
      .flatMap((kind) => surfaceRows(detail, kind))
      .flatMap((surface) => {
        const docs = contractDocs(surface.descriptor.docs);
        return docs ? [{ ...surface, docs }] : [];
      });
  }

  function schemaRefName(value: unknown): string | null {
    if (typeof value === "string" && value.trim()) return value;
    const schema = objectRecord(value)?.schema;
    return typeof schema === "string" && schema.trim() ? schema : null;
  }

  function schemaFromRef(detail: ContractDetail, value: unknown): { schemaName: string | null; schema: ContractSchema | null } {
    const schemaName = schemaRefName(value);
    if (schemaName) return { schemaName, schema: detail.schemas?.[schemaName] ?? null };
    return { schemaName: null, schema: objectRecord(value) ? value as ContractSchema : null };
  }

  function schemaPanel(detail: ContractDetail, label: string, value: unknown): SchemaPanel {
    const resolved = schemaFromRef(detail, value);
    return { label, ...resolved, example: resolved.schema ? exampleFromSchema(resolved.schema) : null };
  }

  function schemaPanelsForSurface(detail: ContractDetail, surface: SurfaceRow): SchemaPanel[] {
    if (surface.kind === "rpc") {
      return [schemaPanel(detail, "Input", surface.descriptor.input), schemaPanel(detail, "Output", surface.descriptor.output)];
    }
    if (surface.kind === "event") {
      return [schemaPanel(detail, "Event", surface.descriptor.event)];
    }
    if (surface.kind === "feed") {
      return [schemaPanel(detail, "Input", surface.descriptor.input), schemaPanel(detail, "Event", surface.descriptor.event)];
    }

    const panels = [schemaPanel(detail, "Input", surface.descriptor.input), schemaPanel(detail, "Output", surface.descriptor.output)];
    if (surface.descriptor.progress !== undefined) panels.push(schemaPanel(detail, "Progress", surface.descriptor.progress));
    const signals = objectRecord(surface.descriptor.signals);
    if (signals) {
      for (const [name, signal] of Object.entries(signals)) {
        panels.push(schemaPanel(detail, `Signal: ${name}`, objectRecord(signal)?.input));
      }
    }
    return panels;
  }

  function referencedSchemaNames(detail: ContractDetail): string[] {
    const names: string[] = [];
    for (const kind of ["rpc", "event", "operation", "feed"] as const) {
      for (const surface of surfaceRows(detail, kind)) {
        for (const key of ["input", "output", "event", "progress"] as const) {
          const name = schemaRefName(surface.descriptor[key]);
          if (name && !names.includes(name)) names.push(name);
        }
        const signals = objectRecord(surface.descriptor.signals);
        if (!signals) continue;
        for (const signal of Object.values(signals)) {
          const name = schemaRefName(objectRecord(signal)?.input);
          if (name && !names.includes(name)) names.push(name);
        }
      }
    }
    return names;
  }

  function schemaRows(detail: ContractDetail): SchemaRow[] {
    const schemas = detail.schemas ?? {};
    const exported = detail.exports?.schemas ?? Object.keys(schemas);
    const referenced = referencedSchemaNames(detail);
    return exported.flatMap((name) => {
      const schema = schemas[name];
      return schema && !referenced.includes(name) ? [{ key: name, name, schema }] : [];
    });
  }

  function subjectForSurface(surface: SurfaceRow): string {
    const subject = surface.descriptor.subject;
    return typeof subject === "string" && subject.trim() ? subject : "-";
  }

  function versionForSurface(surface: SurfaceRow): string {
    const version = surface.descriptor.version;
    return typeof version === "string" && version.trim() ? version : "-";
  }

  function capabilityKeys(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
    return [];
  }

  function capabilityDefinitions(detail: ContractDetail): Array<[string, Record<string, unknown>]> {
    const capabilities = objectRecord(objectRecord(detail)?.capabilities);
    if (!capabilities) return [];
    return Object.entries(capabilities).map(([key, value]) => [key, objectRecord(value) ?? {}]);
  }

  function exampleFromSchema(schema: unknown): unknown {
    if (schema === true) return {};
    if (schema === false) return null;
    const record = objectRecord(schema);
    if (!record) return null;
    if (Array.isArray(record.enum) && record.enum.length > 0) return record.enum[0];
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

  function tabLabel(tab: Tab): string {
    if (tab === "rpc") return "RPC";
    return tab[0].toUpperCase() + tab.slice(1);
  }

  function surfaceKindLabel(kind: SurfaceKind): string {
    if (kind === "rpc") return "RPC";
    if (kind === "event") return "Event";
    if (kind === "operation") return "Operation";
    return "Feed";
  }

  function tabId(tab: Tab): string {
    return `contract-detail-tab-${tab}`;
  }

  function tabPanelId(tab: Tab): string {
    return `contract-detail-panel-${tab}`;
  }

  function selectTab(tab: Tab) {
    activeTab = tab;
    selectedSurfaceKey = null;
  }

  function selectSurface(surface: SurfaceRow) {
    selectedSurfaceKey = surface.key;
  }

  async function load() {
    loading = true;
    error = null;
    contract = null;
    try {
      const response = await coreRequest("Trellis.Contract.Get", { digest }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      contract = response.contract;
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Contract details" description="Inspect the contract API surface, documentation, schemas, and capabilities.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href="/admin/services/contracts">Back to contracts</a>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}<Notice variant="error">{error}</Notice>{/if}

  {#if loading}
    <Panel><LoadingState label="Loading contract" /></Panel>
  {:else if contract}
    <Panel class="flex min-w-0 flex-1 flex-col [&>.card-body]:flex-1">
      <div class="flex flex-wrap items-start justify-between gap-3 border-b border-base-300 pb-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="trellis-identifier truncate text-lg font-semibold">{contract.id}</h2>
            <span class="badge badge-outline badge-sm">{contract.kind}</span>
          </div>
          <div class="text-sm text-base-content/60">{contract.displayName}</div>
          <div class="trellis-identifier mt-1 text-xs text-base-content/50">Digest {digest}</div>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span class="badge badge-outline badge-sm">{Object.keys(contract.rpc ?? {}).length} RPC</span>
        <span class="badge badge-outline badge-sm">{Object.keys(contract.events ?? {}).length} events</span>
        <span class="badge badge-outline badge-sm">{Object.keys(contract.operations ?? {}).length} operations</span>
        <span class="badge badge-outline badge-sm">{Object.keys(objectRecord(contract)?.feeds ?? {}).length} feeds</span>
        <span class="badge badge-outline badge-sm">{Object.keys(contract.schemas ?? {}).length} schemas</span>
      </div>

      <div class="tabs tabs-box tabs-sm mt-4 w-fit bg-base-200/70 p-1" role="tablist" aria-label="Contract detail sections">
        {#each tabs as tab (tab)}
          <button type="button" id={tabId(tab)} role="tab" aria-selected={activeTab === tab} aria-controls={tabPanelId(tab)} class={["tab rounded-field px-4", activeTab === tab && "tab-active bg-base-100 shadow-sm"]} onclick={() => selectTab(tab)}>{tabLabel(tab)}</button>
        {/each}
      </div>

      <div id={tabPanelId(activeTab)} class="mt-4 flex-1" role="tabpanel" aria-labelledby={tabId(activeTab)}>
        {#if activeTab === "docs"}
          <div class="space-y-4">
            <section class="rounded-box border border-base-300 bg-base-200/30 p-3">
              <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-base-content/60">Contract documentation</h3>
              {#if topLevelDocs}
                {#if topLevelDocs.summary}<div class="mb-2 text-sm font-medium">{topLevelDocs.summary}</div>{/if}
                <pre class="markdown-source">{topLevelDocs.markdown}</pre>
              {:else}
                <p class="text-sm text-base-content/60">No top-level contract documentation is declared.</p>
              {/if}
            </section>

            <section class="rounded-box border border-base-300 bg-base-200/30 p-3">
              <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-base-content/60">Surface documentation</h3>
              <div class="space-y-3">
                {#each documentedSurfaces as surface (surface.key)}
                  <article class="rounded-box border border-base-300 bg-base-100/70 p-3">
                    <div class="mb-2 flex flex-wrap items-center gap-2">
                      <span class="badge badge-outline badge-xs">{surfaceKindLabel(surface.kind)}</span>
                      <span class="trellis-identifier text-sm font-medium">{surface.name}</span>
                    </div>
                    {#if surface.docs.summary}<div class="mb-2 text-sm font-medium">{surface.docs.summary}</div>{/if}
                    <pre class="markdown-source">{surface.docs.markdown}</pre>
                  </article>
                {:else}
                  <p class="text-sm text-base-content/60">No documented RPC, event, operation, or feed surfaces were found.</p>
                {/each}
              </div>
            </section>
          </div>
        {:else if activeTab === "rpc" || activeTab === "events" || activeTab === "operations" || activeTab === "feeds"}
          {#if activeSurfaces.length === 0}
            <EmptyState title={`No ${tabLabel(activeTab).toLowerCase()}`} description={`This contract does not declare ${tabLabel(activeTab).toLowerCase()} surfaces.`} />
          {:else if selectedSurface}
            <div class="grid gap-3 lg:min-h-[calc(100vh-22rem)] lg:grid-cols-[18rem_minmax(0,1fr)]">
              <div class="rounded-box border border-base-300 bg-base-200/30 p-2 lg:max-h-[calc(100vh-22rem)] lg:overflow-y-auto">
                <div class="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-base-content/60">Surfaces</div>
                <div class="space-y-1">
                  {#each activeSurfaces as surface (surface.key)}
                    <button type="button" class={["btn h-auto min-h-0 w-full justify-start px-2 py-2 text-left", selectedSurface.key === surface.key ? "btn-primary" : "btn-ghost"]} onclick={() => selectSurface(surface)}>
                      <span class="min-w-0 flex-1">
                        <span class="trellis-identifier block truncate text-xs font-medium">{surface.name}</span>
                        <span class="mt-1 flex flex-wrap gap-1">
                          <span class="badge badge-outline badge-xs">{versionForSurface(surface)}</span>
                          <span class="badge badge-outline badge-xs">{surfaceKindLabel(surface.kind)}</span>
                        </span>
                      </span>
                    </button>
                  {/each}
                </div>
              </div>

              <div class="rounded-box border border-base-300 bg-base-200/40 p-3">
                <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="trellis-identifier text-base font-semibold">{selectedSurface.name}</div>
                    <div class="trellis-identifier text-xs text-base-content/60">{subjectForSurface(selectedSurface)}</div>
                  </div>
                  <div class="flex flex-wrap gap-1">
                    {#each capabilityKeys(objectRecord(selectedSurface.descriptor.capabilities)?.call) as capability (capability)}<span class="badge badge-outline badge-xs trellis-identifier">{capability}</span>{/each}
                  </div>
                </div>

                {#if selectedSurfaceDocs}
                  <div class="mb-3 rounded-box border border-base-300 bg-base-100/70 p-3">
                    {#if selectedSurfaceDocs.summary}<div class="mb-2 text-sm font-medium">{selectedSurfaceDocs.summary}</div>{/if}
                    <pre class="markdown-source">{selectedSurfaceDocs.markdown}</pre>
                  </div>
                {/if}

                {#if selectedSurfaceSchemaPanels.length === 0}
                  <p class="text-xs text-base-content/60">No schema details were found for this surface.</p>
                {:else}
                  <div class="grid gap-3 xl:grid-cols-2">
                    {#each selectedSurfaceSchemaPanels as panel (panel.label)}
                      <div>
                        <div class="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-base-content/60">
                          <span>{panel.label}</span>
                          {#if panel.schemaName}<span class="trellis-identifier normal-case">{panel.schemaName}</span>{/if}
                        </div>
                        {#if panel.schema}
                          {#if panel.example !== null}
                            <div class="mb-1 text-xs font-medium uppercase tracking-wide text-base-content/60">Example</div>
                            <pre class="json-block mt-1">{#each jsonTokens(jsonString(panel.example)) as token (token.key)}<span class={jsonTokenClass(token.kind)}>{token.text}</span>{/each}</pre>
                          {/if}
                          <div class="mb-1 mt-2 text-xs font-medium uppercase tracking-wide text-base-content/60">Schema</div>
                          <pre class="json-block">{#each jsonTokens(jsonString(panel.schema)) as token (token.key)}<span class={jsonTokenClass(token.kind)}>{token.text}</span>{/each}</pre>
                        {:else}
                          <p class="text-xs text-base-content/60">No schema is declared.</p>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        {:else if activeTab === "schemas"}
          {#if exportedSchemaRows.length === 0}
            <EmptyState title="No additional exported schemas" description="No exported schemas outside the RPC, event, operation, and feed surfaces were found." />
          {:else}
            <div class="space-y-3">
              {#each exportedSchemaRows as row (row.key)}
                <div class="rounded-box border border-base-300 bg-base-200/30 p-3">
                  <div class="mb-2 flex flex-wrap items-center gap-2">
                    <span class="trellis-identifier font-medium">{row.name}</span>
                  </div>
                  <pre class="json-block">{#each jsonTokens(jsonString(row.schema)) as token (token.key)}<span class={jsonTokenClass(token.kind)}>{token.text}</span>{/each}</pre>
                </div>
              {/each}
            </div>
          {/if}
        {:else if activeTab === "capabilities"}
          <DataTable>
            <thead><tr><th>Capability</th><th>Name</th><th>Description</th></tr></thead>
            <tbody>
              {#each capabilityEntries as [capability, definition] (capability)}
                <tr>
                  <td class="trellis-identifier font-medium">{capability}</td>
                  <td>{definition.displayName ?? "-"}</td>
                  <td class="text-base-content/70">{definition.description ?? "-"}</td>
                </tr>
              {:else}
                <tr><td colspan="3" class="text-base-content/50">No capabilities.</td></tr>
              {/each}
            </tbody>
          </DataTable>
        {/if}
      </div>
    </Panel>
  {/if}
</section>

<style>
  .json-block,
  .markdown-source {
    overflow-x: auto;
    border-radius: var(--radius-box);
    background: color-mix(in oklab, var(--color-base-100) 88%, var(--color-base-content));
    padding: 0.75rem;
  }

  .json-block {
    font-size: 0.72rem;
    line-height: 1.45;
    color: color-mix(in oklab, var(--color-base-content) 82%, transparent);
  }

  .markdown-source {
    white-space: pre-wrap;
    font-size: 0.78rem;
    line-height: 1.5;
    color: color-mix(in oklab, var(--color-base-content) 78%, transparent);
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
