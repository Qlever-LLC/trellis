<script lang="ts">
  import { isErr, type BaseError, type Result } from "@qlever-llc/result";
  import type { TrellisContractGetOutput } from "@qlever-llc/trellis/sdk/core";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import ConfirmationModal from "$lib/components/ConfirmationModal.svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import SelectableRecordButton from "$lib/components/SelectableRecordButton.svelte";
  import { errorMessage } from "$lib/format";
  import { getNotifications } from "$lib/notifications.svelte";
  import { getTrellis } from "$lib/trellis";

  type CatalogIssueAction = {
    action: "keep-current" | "force-replace";
    label: string;
    description: string;
    risk: "recommended" | "dangerous";
    deploymentIds: string[];
    digests: string[];
  };
  type CatalogIssue = {
    issueId: string;
    kind: string;
    contractId?: string;
    digest?: string;
    message: string;
    deploymentIds: string[];
    effectiveDigests?: string[];
    conflictingDigest?: string;
    conflictingDigests?: string[];
    effectiveDeploymentIds?: string[];
    conflictingDeploymentIds?: string[];
    actions: CatalogIssueAction[];
  };
  type ContractManifest = {
    id: string;
    displayName?: string;
    schemas?: Record<string, unknown>;
    rpc?: Record<string, unknown>;
    events?: Record<string, unknown>;
    operations?: Record<string, unknown>;
  };
  type ChangeKind = "added" | "removed" | "changed";
  type DefinitionDiff = {
    key: string;
    kind: string;
    name: string;
    change: ChangeKind;
    current?: string;
    conflicting?: string;
  };
  type JsonDiffKind = "added" | "removed" | "unchanged";
  type JsonDiffLine = {
    key: string;
    kind: JsonDiffKind;
    content: string;
  };
  type JsonTokenKind = "plain" | "key" | "string" | "number" | "boolean" | "null";
  type JsonToken = {
    key: string;
    kind: JsonTokenKind;
    text: string;
  };
  type CatalogIssueResolveOutput = {
    success: true;
    issueId: string;
    action: CatalogIssueAction["action"];
  };
  type CatalogOutput = {
    catalog: {
      issues?: CatalogIssue[];
    };
  };
  type RpcTakeable<T> = { take(): Promise<T | Result<never, BaseError>> };
  type CoreRequest = {
    (method: "Trellis.Catalog", input: Record<string, never>): RpcTakeable<CatalogOutput>;
    (method: "Trellis.Contract.Get", input: { digest: string }): RpcTakeable<TrellisContractGetOutput>;
  };
  type CatalogIssueResolveRequest = {
    (method: "Auth.CatalogIssues.Resolve", input: { issueId: string; action: CatalogIssueAction["action"] }): RpcTakeable<CatalogIssueResolveOutput>;
  };

  const trellis = getTrellis();
  const coreRequest = trellis.request.bind(trellis) as CoreRequest;
  const catalogIssueResolveRequest = trellis.request.bind(trellis) as CatalogIssueResolveRequest;
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let manifestError = $state<string | null>(null);
  let pendingAction = $state<CatalogIssueAction["action"] | null>(null);
  let issues = $state.raw<CatalogIssue[]>([]);
  let manifests = $state.raw<Record<string, ContractManifest>>({});
  let selectedIssueId = $state(page.url.searchParams.get("issue") ?? "");
  let confirmationModal: ConfirmationModal | undefined = $state();

  const selectedIssue = $derived(issues.find((issue) => issue.issueId === selectedIssueId) ?? issues[0] ?? null);
  const effectiveDigests = $derived(selectedIssue ? uniqueValues(selectedIssue.effectiveDigests ?? []) : []);
  const conflictingDigests = $derived(selectedIssue ? uniqueValues([...(selectedIssue.conflictingDigests ?? []), selectedIssue.conflictingDigest]) : []);
  const surfaceDiffs = $derived(selectedIssue ? buildSurfaceDiffs(effectiveDigests, conflictingDigests) : []);
  const schemaDiffs = $derived(selectedIssue ? buildSchemaDiffs(effectiveDigests, conflictingDigests) : []);
  const forcedUpdateActions = $derived(selectedIssue
    ? selectedIssue.actions
      .filter((action) => action.action === "force-replace" || action.action === "keep-current")
      .toSorted((left, right) => actionSortOrder(left.action) - actionSortOrder(right.action))
    : []);

  function uniqueValues(values: readonly (string | undefined)[]): string[] {
    return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
  }

  function issueDigests(issue: CatalogIssue): string[] {
    return uniqueValues([
      issue.digest,
      ...(issue.effectiveDigests ?? []),
      issue.conflictingDigest,
      ...(issue.conflictingDigests ?? []),
      ...issue.actions.flatMap((action) => action.digests),
    ]);
  }

  function formatDigest(digest: string): string {
    return digest.length > 18 ? `${digest.slice(0, 12)}...${digest.slice(-6)}` : digest;
  }

  function actionCopy(action: CatalogIssueAction): string {
    if (action.action === "keep-current") return "Do not accept the proposed forced update. The active implementation offers remain unchanged.";
    return "Accept the forced update and replace active implementations for this contract ID.";
  }

  function actionLabel(action: CatalogIssueAction): string {
    if (action.action === "keep-current") return "Do not accept update";
    if (action.action === "force-replace") return "Accept";
    return action.label;
  }

  function actionSortOrder(action: CatalogIssueAction["action"]): number {
    if (action === "force-replace") return 0;
    return 1;
  }

  function issueSummary(issue: CatalogIssue): string {
    if (issue.kind === "incompatible-active-contract") {
      return `A forced contract update is pending for ${issue.contractId ?? "this contract"}. Accepting it destructively replaces accepted implementation offers for that contract ID.`;
    }
    return `This forced contract update affects ${issue.contractId ?? "a contract"}. Review the active and proposed implementations before choosing whether to accept it.`;
  }

  function issueTitle(issue: CatalogIssue): string {
    if (issue.kind === "incompatible-active-contract") return "Forced Contract Update";
    return issue.kind.replaceAll("-", " ");
  }

  function surfacesForDigest(digest: string): DefinitionDiff[] {
    const manifest = manifests[digest];
    if (!manifest) return [];
    return [
      ...surfaceRows("RPC", manifest.rpc),
      ...surfaceRows("Event", manifest.events),
      ...surfaceRows("Operation", manifest.operations),
    ];
  }

  function surfaceRows(kind: string, surfaces?: Record<string, unknown>): DefinitionDiff[] {
    return Object.entries(surfaces ?? {}).map(([name, definition]) => ({
      key: `${kind}:${name}`,
      kind,
      name,
      change: "changed",
      current: formatDefinition(definition),
    }));
  }

  function buildSurfaceDiffs(currentDigests: readonly string[], newDigests: readonly string[]): DefinitionDiff[] {
    const rows: Record<string, DefinitionDiff> = {};
    for (const digest of currentDigests) {
      for (const row of surfacesForDigest(digest)) rows[row.key] = { ...row, change: "removed" };
    }
    for (const digest of newDigests) {
      for (const row of surfacesForDigest(digest)) {
        const existing = rows[row.key];
        if (!existing) {
          rows[row.key] = { ...row, change: "added", conflicting: row.current, current: undefined };
          continue;
        }
        if (existing.current === row.current) {
          delete rows[row.key];
          continue;
        }
        rows[row.key] = { ...existing, change: "changed", conflicting: row.current };
      }
    }
    return Object.values(rows).toSorted((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
  }

  function schemasForDigest(digest: string): DefinitionDiff[] {
    return Object.entries(manifests[digest]?.schemas ?? {}).map(([name, schema]) => ({
      key: `Schema:${name}`,
      kind: "Schema",
      name,
      change: "changed",
      current: formatDefinition(schema),
    }));
  }

  function buildSchemaDiffs(currentDigests: readonly string[], newDigests: readonly string[]): DefinitionDiff[] {
    const rows: Record<string, DefinitionDiff> = {};
    for (const digest of currentDigests) {
      for (const row of schemasForDigest(digest)) rows[row.key] = { ...row, change: "removed" };
    }
    for (const digest of newDigests) {
      for (const row of schemasForDigest(digest)) {
        const existing = rows[row.key];
        if (!existing) {
          rows[row.key] = { ...row, change: "added", conflicting: row.current, current: undefined };
          continue;
        }
        if (existing.current === row.current) {
          delete rows[row.key];
          continue;
        }
        rows[row.key] = { ...existing, change: "changed", conflicting: row.current };
      }
    }
    return Object.values(rows).toSorted((left, right) => left.name.localeCompare(right.name));
  }

  function normalizeDefinition(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalizeDefinition);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, normalizeDefinition(entry)]),
      );
    }
    return value;
  }

  function formatDefinition(value: unknown): string {
    return JSON.stringify(normalizeDefinition(value), null, 2) ?? "";
  }

  function jsonLines(json: string): JsonDiffLine[] {
    return json.split("\n").map((content, index) => ({ key: `json:${index}`, kind: "unchanged", content }));
  }

  function jsonTokenClass(kind: JsonTokenKind): string | undefined {
    if (kind === "plain") return undefined;
    return `json-${kind}`;
  }

  function jsonTokens(line: string): JsonToken[] {
    const tokens: JsonToken[] = [];
    const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    let offset = 0;
    for (const match of line.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > offset) tokens.push({ key: `plain:${offset}`, kind: "plain", text: line.slice(offset, index) });
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
    if (offset < line.length) tokens.push({ key: `plain:${offset}`, kind: "plain", text: line.slice(offset) });
    return tokens;
  }

  function jsonDiffLines(previous: string, next: string): JsonDiffLine[] {
    const previousLines = previous.split("\n");
    const nextLines = next.split("\n");
    const cellCount = previousLines.length * nextLines.length;
    if (cellCount > 40_000) {
      return [
        ...previousLines.map((content, index) => ({ key: `removed:${index}`, kind: "removed" as const, content })),
        ...nextLines.map((content, index) => ({ key: `added:${index}`, kind: "added" as const, content })),
      ];
    }

    const lengths = Array.from({ length: previousLines.length + 1 }, () => Array<number>(nextLines.length + 1).fill(0));
    for (let previousIndex = previousLines.length - 1; previousIndex >= 0; previousIndex -= 1) {
      for (let nextIndex = nextLines.length - 1; nextIndex >= 0; nextIndex -= 1) {
        lengths[previousIndex][nextIndex] = previousLines[previousIndex] === nextLines[nextIndex]
          ? lengths[previousIndex + 1][nextIndex + 1] + 1
          : Math.max(lengths[previousIndex + 1][nextIndex], lengths[previousIndex][nextIndex + 1]);
      }
    }

    const rows: JsonDiffLine[] = [];
    let previousIndex = 0;
    let nextIndex = 0;
    while (previousIndex < previousLines.length || nextIndex < nextLines.length) {
      if (previousIndex < previousLines.length && nextIndex < nextLines.length && previousLines[previousIndex] === nextLines[nextIndex]) {
        rows.push({ key: `unchanged:${previousIndex}:${nextIndex}`, kind: "unchanged", content: previousLines[previousIndex] });
        previousIndex += 1;
        nextIndex += 1;
      } else if (nextIndex < nextLines.length && (previousIndex === previousLines.length || lengths[previousIndex][nextIndex + 1] >= lengths[previousIndex + 1][nextIndex])) {
        rows.push({ key: `added:${previousIndex}:${nextIndex}`, kind: "added", content: nextLines[nextIndex] });
        nextIndex += 1;
      } else if (previousIndex < previousLines.length) {
        rows.push({ key: `removed:${previousIndex}:${nextIndex}`, kind: "removed", content: previousLines[previousIndex] });
        previousIndex += 1;
      }
    }
    return rows;
  }

  function definitionDiffLines(row: DefinitionDiff): JsonDiffLine[] {
    if (row.change === "added") return jsonDiffLines("", row.conflicting ?? row.current ?? "").filter((line) => line.content !== "" || line.kind !== "removed");
    if (row.change === "removed") return jsonDiffLines(row.current ?? row.conflicting ?? "", "").filter((line) => line.content !== "" || line.kind !== "added");
    return jsonDiffLines(row.current ?? "", row.conflicting ?? "");
  }

  function diffLinePrefix(kind: JsonDiffKind): string {
    if (kind === "added") return "+";
    if (kind === "removed") return "-";
    return " ";
  }

  function diffLineClass(kind: JsonDiffKind): string {
    if (kind === "added") return "diff-line diff-line-added";
    if (kind === "removed") return "diff-line diff-line-removed";
    return "diff-line";
  }

  function changeNoun(change: ChangeKind): string {
    if (change === "added") return "Added";
    if (change === "removed") return "Removed";
    return "Changed";
  }

  function changeBadgeClass(change: ChangeKind): string {
    if (change === "added") return "badge-success";
    if (change === "removed") return "badge-warning";
    return "badge-error";
  }

  async function load() {
    loading = true;
    error = null;
    manifestError = null;
    try {
      const catalogRes = await coreRequest("Trellis.Catalog", {}).take();
      if (isErr(catalogRes)) { error = errorMessage(catalogRes); return; }

      issues = (catalogRes.catalog.issues ?? []).filter((issue) => issue.kind === "incompatible-active-contract");
      if (selectedIssueId && !issues.some((issue) => issue.issueId === selectedIssueId)) selectedIssueId = "";
      if (!selectedIssueId) selectedIssueId = issues[0]?.issueId ?? "";

      const digests = uniqueValues(issues.flatMap(issueDigests));
      const loadedManifests: Record<string, ContractManifest> = {};
      const failures: string[] = [];
      await Promise.all(digests.map(async (digest) => {
        const contractRes = await coreRequest("Trellis.Contract.Get", { digest }).take();
        if (isErr(contractRes)) {
          failures.push(`${formatDigest(digest)}: ${errorMessage(contractRes)}`);
          return;
        }
        loadedManifests[digest] = contractRes.contract;
      }));
      manifests = loadedManifests;
      if (failures.length > 0) manifestError = `Some contract manifests could not be loaded: ${failures.join("; ")}`;
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  async function resolveIssue(action: CatalogIssueAction) {
    if (!selectedIssue) return;
    pendingAction = action.action;
    error = null;
    try {
      const response = await catalogIssueResolveRequest("Auth.CatalogIssues.Resolve", { issueId: selectedIssue.issueId, action: action.action }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`${actionLabel(action)} applied to forced contract update ${selectedIssue.issueId}.`, "Forced update resolved");
      await load();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      pendingAction = null;
    }
  }

  async function requestResolveIssue(action: CatalogIssueAction) {
    if (!selectedIssue) return;
    if (action.action === "force-replace") {
      const contractId = selectedIssue.contractId;
      if (!contractId) {
        error = "Cannot accept a forced contract update without a contract ID.";
        return;
      }
      const confirmed = await confirmationModal?.confirm({
        title: "Accept forced contract update?",
        message: "This destructively replaces active implementations for this contract ID. Services still using the active contract may fail to reconnect.",
        confirmLabel: actionLabel(action),
        targetLabel: "Contract ID",
        targetName: contractId,
        expectedValue: contractId,
      });
      if (!confirmed) return;
    } else if (action.action === "keep-current") {
      const confirmed = await confirmationModal?.confirm({
        title: "Do not accept forced update?",
        message: "The active implementations remain unchanged and the proposed update is not accepted.",
        confirmLabel: actionLabel(action),
        targetLabel: "Forced update",
        targetName: selectedIssue.issueId,
      });
      if (!confirmed) return;
    }
    await resolveIssue(action);
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Forced Contract Update" description="Review pending forced contract updates and decide whether to accept them for active service contracts.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
      <a class="btn btn-ghost btn-sm" href={resolve("/(app)/admin/services")}>Back to services</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <Notice variant="error">{error}</Notice>
  {/if}
  {#if manifestError}
    <Notice variant="warning">{manifestError}</Notice>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading forced contract updates" /></Panel>
  {:else if issues.length === 0}
    <EmptyState title="No forced contract updates" description="The active service catalog has no pending forced contract updates." />
  {:else if selectedIssue}
    <div class="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <Panel title="Issues" eyebrow={`${issues.length} active`}>
        <div class="space-y-2">
          {#each issues as issue (issue.issueId)}
            <SelectableRecordButton
              selected={selectedIssue.issueId === issue.issueId}
              tone="error"
              class="text-sm"
              onclick={() => { selectedIssueId = issue.issueId; }}
            >
              <div class="font-medium">{issueTitle(issue)}</div>
              <div class="mt-2 flex flex-wrap gap-1">
                <span class="badge badge-error badge-outline badge-xs">{issue.kind}</span>
                {#if issue.contractId}<span class="badge badge-outline badge-xs trellis-identifier">{issue.contractId}</span>{/if}
                {#if issue.digest}<span class="badge badge-outline badge-xs trellis-identifier" title={issue.digest}>{formatDigest(issue.digest)}</span>{/if}
              </div>
            </SelectableRecordButton>
          {/each}
        </div>
      </Panel>

      <div class="min-w-0 space-y-4">
        <Panel title="Forced Contract Update" eyebrow="Catalog update">
          <div class="space-y-4">
            <div class="rounded-box border border-error/25 bg-error/10 p-3 text-sm">
              <div class="break-words font-medium [overflow-wrap:anywhere]">{issueSummary(selectedIssue)}</div>
            </div>
          </div>
        </Panel>

        <Panel title="Contract changes" eyebrow="Only changed entries">
          <div class="space-y-4">
            <div class="min-w-0">
              <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">Owned surfaces</h3>
              <DataTable>
                <thead><tr><th>Surface</th><th>Kind</th><th>Change</th></tr></thead>
                <tbody>
                  {#each surfaceDiffs as row (row.key)}
                    <tr>
                      <td class="trellis-identifier break-all">{row.name}</td>
                      <td>{row.kind}</td>
                      <td><span class={["badge badge-xs", changeBadgeClass(row.change)]}>{row.change}</span></td>
                    </tr>
                    <tr>
                      <td colspan="3" class="bg-base-200/30 p-3">
                        <div class="space-y-2 text-xs">
                          <div class="flex items-center justify-between gap-2">
                            <span class="font-medium">{changeNoun(row.change)} definition diff</span>
                            <span class="text-base-content/50">- current / + proposed</span>
                          </div>
                          <pre class="diff-block">{#each definitionDiffLines(row) as line (line.key)}<span class={diffLineClass(line.kind)}><span class="diff-prefix">{diffLinePrefix(line.kind)}</span><span class="diff-content">{#each jsonTokens(line.content) as token (token.key)}<span class={jsonTokenClass(token.kind)}>{token.text}</span>{/each}</span></span>{/each}</pre>
                          <div class="grid gap-2 xl:grid-cols-2">
                            {#if row.current}
                              <details class="collapse collapse-arrow border border-base-300 bg-base-100">
                                <summary class="collapse-title min-h-0 px-3 py-2 text-xs font-medium">Full Current JSON</summary>
                                <div class="collapse-content px-3 pb-3"><pre class="json-block">{#each jsonLines(row.current) as jsonLine (jsonLine.key)}<span class="json-line">{#each jsonTokens(jsonLine.content) as token (token.key)}<span class={jsonTokenClass(token.kind)}>{token.text}</span>{/each}</span>{/each}</pre></div>
                              </details>
                            {/if}
                            {#if row.conflicting}
                              <details class="collapse collapse-arrow border border-base-300 bg-base-100">
                                <summary class="collapse-title min-h-0 px-3 py-2 text-xs font-medium">Full Proposed JSON</summary>
                                <div class="collapse-content px-3 pb-3"><pre class="json-block">{#each jsonLines(row.conflicting) as jsonLine (jsonLine.key)}<span class="json-line">{#each jsonTokens(jsonLine.content) as token (token.key)}<span class={jsonTokenClass(token.kind)}>{token.text}</span>{/each}</span>{/each}</pre></div>
                              </details>
                            {/if}
                          </div>
                        </div>
                      </td>
                    </tr>
                  {:else}
                    <tr><td colspan="3" class="text-base-content/50">No changed RPC, event, or operation surfaces.</td></tr>
                  {/each}
                </tbody>
              </DataTable>
            </div>
            <div class="min-w-0">
              <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">Schemas</h3>
              <DataTable>
                <thead><tr><th>Schema</th><th>Change</th></tr></thead>
                <tbody>
                  {#each schemaDiffs as row (row.key)}
                    <tr>
                      <td class="trellis-identifier break-all">{row.name}</td>
                      <td><span class={["badge badge-xs", changeBadgeClass(row.change)]}>{row.change}</span></td>
                    </tr>
                    <tr>
                      <td colspan="2" class="bg-base-200/30 p-3">
                        <div class="space-y-2 text-xs">
                          <div class="flex items-center justify-between gap-2">
                            <span class="font-medium">{changeNoun(row.change)} schema diff</span>
                            <span class="text-base-content/50">- current / + proposed</span>
                          </div>
                          <pre class="diff-block">{#each definitionDiffLines(row) as line (line.key)}<span class={diffLineClass(line.kind)}><span class="diff-prefix">{diffLinePrefix(line.kind)}</span><span class="diff-content">{#each jsonTokens(line.content) as token (token.key)}<span class={jsonTokenClass(token.kind)}>{token.text}</span>{/each}</span></span>{/each}</pre>
                          <div class="grid gap-2 xl:grid-cols-2">
                            {#if row.current}
                              <details class="collapse collapse-arrow border border-base-300 bg-base-100">
                                <summary class="collapse-title min-h-0 px-3 py-2 text-xs font-medium">Full Current JSON</summary>
                                <div class="collapse-content px-3 pb-3"><pre class="json-block">{#each jsonLines(row.current) as jsonLine (jsonLine.key)}<span class="json-line">{#each jsonTokens(jsonLine.content) as token (token.key)}<span class={jsonTokenClass(token.kind)}>{token.text}</span>{/each}</span>{/each}</pre></div>
                              </details>
                            {/if}
                            {#if row.conflicting}
                              <details class="collapse collapse-arrow border border-base-300 bg-base-100">
                                <summary class="collapse-title min-h-0 px-3 py-2 text-xs font-medium">Full Proposed JSON</summary>
                                <div class="collapse-content px-3 pb-3"><pre class="json-block">{#each jsonLines(row.conflicting) as jsonLine (jsonLine.key)}<span class="json-line">{#each jsonTokens(jsonLine.content) as token (token.key)}<span class={jsonTokenClass(token.kind)}>{token.text}</span>{/each}</span>{/each}</pre></div>
                              </details>
                            {/if}
                          </div>
                        </div>
                      </td>
                    </tr>
                  {:else}
                    <tr><td colspan="2" class="text-base-content/50">No changed schemas.</td></tr>
                  {/each}
                </tbody>
              </DataTable>
            </div>
          </div>
        </Panel>

        <Panel title="Forced update decision" eyebrow="Choose one">
          <div class="grid gap-3 md:grid-cols-2">
            {#each forcedUpdateActions as action (`${selectedIssue.issueId}:${action.action}`)}
              <div class={["rounded-box border p-3", action.risk === "recommended" ? "border-success/30 bg-success/10" : "border-error/30 bg-error/10"]}>
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <h3 class="font-semibold">{actionLabel(action)}</h3>
                    <p class="mt-1 text-sm text-base-content/70">{actionCopy(action)}</p>
                  </div>
                  <span class={["badge badge-sm", action.risk === "recommended" ? "badge-success" : "badge-error"]}>{action.risk}</span>
                </div>
                <div class="mt-3 trellis-token-list">
                  {#each action.digests as digest (digest)}
                    <span class="badge badge-outline badge-xs trellis-identifier break-all" title={digest}>{formatDigest(digest)}</span>
                  {/each}
                </div>
                <div class="mt-3 flex justify-end">
                  <button
                    type="button"
                    class={["btn btn-sm", action.risk === "recommended" ? "btn-success" : "btn-error"]}
                    disabled={pendingAction !== null}
                    onclick={() => void requestResolveIssue(action)}
                  >
                    {pendingAction === action.action ? "Applying..." : actionLabel(action)}
                  </button>
                </div>
              </div>
            {/each}
          </div>
        </Panel>
      </div>
    </div>
  {/if}
</section>

<ConfirmationModal bind:this={confirmationModal} />

<style>
  .json-block {
    max-height: 16rem;
    overflow: auto;
    border-radius: var(--radius-box);
    background: color-mix(in oklab, var(--color-base-100) 88%, var(--color-base-content));
    padding: 0.75rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 0.72rem;
    line-height: 1.45;
    color: color-mix(in oklab, var(--color-base-content) 82%, transparent);
  }

  .diff-block {
    max-height: 18rem;
    overflow: auto;
    border-radius: var(--radius-box);
    border: 1px solid var(--color-base-300);
    background: color-mix(in oklab, var(--color-base-100) 88%, var(--color-base-content));
    padding: 0.25rem 0;
    font-size: 0.72rem;
    line-height: 1.45;
    color: color-mix(in oklab, var(--color-base-content) 82%, transparent);
  }

  .diff-line {
    display: block;
    min-width: max-content;
    padding: 0 0.75rem;
    white-space: pre;
  }

  .diff-line-added {
    background: color-mix(in oklab, var(--color-success) 16%, transparent);
    color: color-mix(in oklab, var(--color-success) 70%, var(--color-base-content));
  }

  .diff-line-removed {
    background: color-mix(in oklab, var(--color-error) 14%, var(--color-warning) 8%);
    color: color-mix(in oklab, var(--color-error) 68%, var(--color-base-content));
  }

  .diff-prefix {
    display: inline-block;
    width: 1.25rem;
    user-select: none;
  }

  .diff-content {
    overflow-wrap: normal;
  }

  .json-line {
    display: block;
  }

  .json-block :global(.json-key) {
    color: var(--color-info);
  }

  .diff-block :global(.json-key) {
    color: var(--color-info);
  }

  .json-block :global(.json-string) {
    color: var(--color-success);
  }

  .diff-block :global(.json-string) {
    color: var(--color-success);
  }

  .json-block :global(.json-number),
  .json-block :global(.json-boolean) {
    color: var(--color-warning);
  }

  .diff-block :global(.json-number),
  .diff-block :global(.json-boolean) {
    color: var(--color-warning);
  }

  .json-block :global(.json-null) {
    color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  }

  .diff-block :global(.json-null) {
    color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  }
</style>
