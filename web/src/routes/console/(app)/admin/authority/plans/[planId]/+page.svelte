<script lang="ts">
  import { ulid } from "ulid";
  import { isErr, type BaseError, type Result } from "@qlever-llc/result";
  import type { DeploymentAuthorityKind, DeploymentAuthorityPlan } from "@qlever-llc/trellis/auth";
  import type { AuthDeploymentAuthorityPlansGetOutput } from "@trellis/apis/trellis.auth";
  import { goto } from "$app/navigation";
  import { resolve } from "$lib/console_paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import {
    applyBreakingChanges,
    contractManifestDiffRows,
    type ContractChangeKind,
    type ContractDiffRow,
    type PlanSummaryEntry,
    type PlanSummaryField,
    type PlanSummaryGroup,
    type PlanSummaryKind,
  } from "$lib/authority_console";
  import { structuredPatch } from "diff";
  import { schemaDiffFields } from "$lib/schema-diff";
  import { errorMessage } from "$lib/format";
  import { getTrellis } from "$lib/trellis";
  import Icon from "$lib/components/Icon.svelte";
  import { fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";

  type PlanState = "pending" | "accepted" | "rejected" | "expired" | "superseded";
  type AuthorityKind = DeploymentAuthorityKind;
  type ContractDetail = Record<string, unknown> & { id: string };
  type DiffGroup = "contracts" | "surfaces" | "schemas" | "resources" | "capabilities";
  type SummaryField = PlanSummaryField;
  type SummaryEntry = PlanSummaryEntry;
  type SummaryKind = PlanSummaryKind;
  type SummaryGroup = PlanSummaryGroup;
  type PageError = { kind: "load" | "decision"; message: string };
  type RpcTakeable<T> = { take(): Promise<T | Result<never, BaseError>> };
  type AuthorityPlansRequest = {
    (method: "Auth.DeploymentAuthority.Plans.Get", input: { planId: string }): RpcTakeable<{ plan: DeploymentAuthorityPlan }>;
    (method: "Auth.DeploymentAuthority.Plans.List", input: { deploymentId: string; state: PlanState; limit: number; offset?: number }): RpcTakeable<{ entries: DeploymentAuthorityPlan[] }>;
    (method: "Auth.DeploymentAuthority.Get", input: { deploymentId: string }): RpcTakeable<{ authority: { kind: AuthorityKind } }>;
    (method: "Auth.DeploymentAuthority.AcceptUpdate", input: { planId: string; expectedDesiredVersion?: string }): RpcTakeable<unknown>;
    (method: "Auth.DeploymentAuthority.AcceptMigration", input: { planId: string; expectedDesiredVersion?: string; acknowledgement: string }): RpcTakeable<unknown>;
    (method: "Auth.DeploymentAuthority.Reject", input: { planId: string; reason?: string }): RpcTakeable<unknown>;
  };

  const trellis = getTrellis();
  const planId = $derived(decodeURIComponent(page.params.planId ?? ""));

  let loading = $state(true);
  let acting = $state(false);
  let error = $state<PageError | null>(null);
  let notice = $state<string | null>(null);
  let plan = $state.raw<DeploymentAuthorityPlan | null>(null);
  let previousContract = $state.raw<ContractDetail | null>(null);
  let authorityKind = $state<AuthorityKind | null>(null);
  let acknowledgeChecked = $state(false);
  let rejectReason = $state("");
  let rejectDetails = $state("");
  let activeTab = $state<"summary" | "full">("summary");

  const planStatus = $derived(plan ? planState(plan) : "pending");
  const pending = $derived(planStatus === "pending");
  const contractDiff = $derived(contractManifestDiffRows(previousContract, plan?.proposal.contract));
  const capabilityRows = $derived(contractDiff.capabilities);
  const surfaceRows = $derived(contractDiff.surfaces);
  const resourceRows = $derived(contractDiff.resources);
  const schemaRows = $derived(contractDiff.schemas);
  const contractRows = $derived(contractDiff.contracts);
  const isMigration = $derived(plan?.classification === "migration");
  const migrationAcknowledged = $derived(acknowledgeChecked);
  const rejectReady = $derived(rejectReason.trim().length > 0);
  const summaryGroups = $derived(buildSummary(capabilityRows, surfaceRows, resourceRows, schemaRows, contractRows));
  const annotatedSummary = $derived(applyBreakingChanges(summaryGroups, plan?.breakingChanges ?? []));
  const summaryEntryCount = $derived(summaryGroups.reduce((n, g) => n + g.entries.length, 0));
  const summaryBreakingCount = $derived(annotatedSummary.groups.reduce((n, g) => n + g.entries.filter((e) => e.breaking).length, 0));
  const unmatchedBreaking = $derived(annotatedSummary.unmatched);
  const jsonDiff = $derived(buildJsonDiff(previousContract, plan?.proposal.contract));
  const diffContext = 3;
  const diffRows = $derived(buildDiffRows(jsonDiff, diffContext));
  let expandedGaps = $state<Set<number>>(new Set());
  let expandedDetails = $state<Set<string>>(new Set());

  function toggleGap(gapIndex: number) {
    const next = new SvelteSet(expandedGaps);
    if (next.has(gapIndex)) next.delete(gapIndex);
    else next.add(gapIndex);
    expandedGaps = next;
  }
  function isGapExpanded(gapIndex: number): boolean {
    return expandedGaps.has(gapIndex);
  }
  function expandAllGaps() {
    const all = new SvelteSet<number>();
    for (const row of diffRows) {
      if (row.kind === "gap") all.add(row.gapIndex);
    }
    expandedGaps = all;
  }
  function collapseAllGaps() {
    expandedGaps = new Set();
  }
  const gapCount = $derived(diffRows.filter((r) => r.kind === "gap").length);
  const expandedGapCount = $derived(diffRows.filter((r) => r.kind === "gap" && expandedGaps.has(r.gapIndex)).length);
  const allGapsExpanded = $derived(gapCount > 0 && expandedGapCount === gapCount);

  function planState(value: DeploymentAuthorityPlan): PlanState {
    if ("state" in value && isPlanState(value.state)) return value.state;
    return "pending";
  }

  function isPlanState(value: unknown): value is PlanState {
    return value === "pending" || value === "accepted" || value === "rejected" || value === "expired" || value === "superseded";
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function unknownEquals(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left) && Array.isArray(right) &&
        left.length === right.length &&
        left.every((entry, index) => unknownEquals(entry, right[index]));
    }
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) =>
        key === rightKeys[index] && unknownEquals(left[key], right[key])
      );
  }

  function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((v) => typeof v === "string");
  }

  function stringField(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  function summarizeCapability(row: ContractDiffRow): SummaryEntry {
    const before = isRecord(row.before) ? row.before : null;
    const after = isRecord(row.after) ? row.after : null;
    if (row.change === "Add") {
      const desc = (after ? stringField(after, "description") : null) ?? "new permission";
      return { id: row.id, change: "Add", kind: "permission", name: row.name, summary: desc, fields: [], breaking: false };
    }
    if (row.change === "Remove") {
      return { id: row.id, change: "Remove", kind: "permission", name: row.name, summary: "", fields: [], breaking: false };
    }
    const fields: SummaryField[] = [];
    const beforeDesc = before ? stringField(before, "description") : null;
    const afterDesc = after ? stringField(after, "description") : null;
    if (beforeDesc !== afterDesc) fields.push(scalarField("description", beforeDesc ?? "—", afterDesc ?? "—"));
    const beforeConseq = before ? stringField(before, "consequence") : null;
    const afterConseq = after ? stringField(after, "consequence") : null;
    if (beforeConseq !== afterConseq) fields.push(scalarField("consequence", beforeConseq ?? "—", afterConseq ?? "—"));
    const beforeName = before ? stringField(before, "displayName") : null;
    const afterName = after ? stringField(after, "displayName") : null;
    if (beforeName !== afterName) fields.push(scalarField("display name", beforeName ?? "—", afterName ?? "—"));
    const summary = buildChangeSummary(fields);
    return { id: row.id, change: "Change", kind: "permission", name: row.name, summary, fields, breaking: false };
  }

  function buildChangeSummary(_fields: SummaryField[]): string {
    return "";
  }

  function summarizeSurface(row: ContractDiffRow): SummaryEntry {
    const before = isRecord(row.before) ? row.before : null;
    const after = isRecord(row.after) ? row.after : null;
    const kindLabel = surfaceKindLabel(row.kind);
    if (row.change === "Add") {
      const fields: SummaryField[] = [];
      if (after) {
        const subject = stringField(after, "subject");
        if (subject) fields.push(scalarField("subject", "—", subject));
        const desc = stringField(after, "description");
        if (desc) fields.push(scalarField("description", "—", desc));
        const reqs = Array.isArray(after.requiredCapabilities) ? after.requiredCapabilities.filter((v): v is string => typeof v === "string") : [];
        if (reqs.length > 0) fields.push(stringSetField("required caps", [], reqs, true));
      }
      return { id: row.id, change: "Add", kind: surfaceSummaryKind(row.kind), name: row.name, summary: "", fields, breaking: false };
    }
    if (row.change === "Remove") {
      return { id: row.id, change: "Remove", kind: surfaceSummaryKind(row.kind), name: row.name, summary: "", fields: [], breaking: false };
    }
    const fields: SummaryField[] = [];
    const beforeSubject = before ? stringField(before, "subject") : null;
    const afterSubject = after ? stringField(after, "subject") : null;
    if (beforeSubject !== null || afterSubject !== null) fields.push(scalarField("subject", beforeSubject ?? "—", afterSubject ?? "—", true));
    for (const key of ["description", "purpose", "consequence"]) {
      const b = before ? stringField(before, key) : null;
      const a = after ? stringField(after, key) : null;
      if (b !== a) fields.push(scalarField(key, b ?? "—", a ?? "—"));
    }
    const beforeReqs = before && Array.isArray(before.requiredCapabilities) ? before.requiredCapabilities.filter((v): v is string => typeof v === "string") : [];
    const afterReqs = after && Array.isArray(after.requiredCapabilities) ? after.requiredCapabilities.filter((v): v is string => typeof v === "string") : [];
    if (beforeReqs.length > 0 || afterReqs.length > 0) {
      const field = stringSetField("required caps", beforeReqs, afterReqs);
      if (field.added.length + field.removed.length > 0) fields.push(field);
    }
    for (const [label, key] of [["input", "input"], ["output", "output"], ["event", "event"], ["progress", "progress"], ["payload", "payload"], ["result", "result"], ["error", "error"], ["request", "requestModel"], ["response", "responseModel"]] as const) {
      const b = before ? schemaRefLabel(before, key) : null;
      const a = after ? schemaRefLabel(after, key) : null;
      if (b !== a) fields.push(scalarField(label, b ?? "—", a ?? "—", true));
    }
    const summary = buildChangeSummary(fields);
    return { id: row.id, change: "Change", kind: surfaceSummaryKind(row.kind), name: row.name, summary, fields, breaking: false };
  }

  function surfaceKindLabel(kind: string): string {
    if (kind === "RPC") return "API method";
    if (kind === "Operation") return "operation";
    if (kind === "Event") return "event";
    if (kind === "Feed") return "feed";
    return "interface";
  }

  function surfaceSummaryKind(kind: string): SummaryKind {
    if (kind === "RPC" || kind === "Operation" || kind === "Event" || kind === "Feed") return "api";
    return "metadata";
  }

  function describeSurface(record: Record<string, unknown> | null, prefix: "new" | "removed"): string | null {
    if (!record) return null;
    const subject = stringField(record, "subject");
    const purpose = stringField(record, "purpose");
    const input = schemaRefLabel(record, "input");
    if (subject) return `${prefix} ${surfaceKindLabel(surfaceKindFromRecord(record))} at ${subject}`;
    if (purpose) return purpose;
    if (input) return `${prefix} interface using data shape ${input}`;
    return null;
  }

  function surfaceKindFromRecord(record: Record<string, unknown>): string {
    if ("requestModel" in record || "responseModel" in record) return "Feed";
    if ("request" in record || "progress" in record) return "Operation";
    if ("event" in record) return "Event";
    if ("input" in record || "output" in record) return "RPC";
    return "RPC";
  }

  function schemaRefLabel(record: Record<string, unknown>, key: string): string | null {
    const ref = record[key];
    if (typeof ref === "string" && ref.length > 0) return ref;
    if (isRecord(ref)) {
      const nested = ref.schema;
      if (typeof nested === "string" && nested.length > 0) return nested;
    }
    return null;
  }

  function formatList(items: string[]): string {
    if (items.length === 0) return "";
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  }

  function stringSetField(label: string, before: unknown, after: unknown, mono = true): Extract<SummaryField, { kind: "set" }> {
    const beforeSet = new Set(coerceToStringArray(before));
    const afterSet = new Set(coerceToStringArray(after));
    const added: string[] = [];
    const removed: string[] = [];
    const kept: string[] = [];
    for (const value of afterSet) {
      if (beforeSet.has(value)) kept.push(value);
      else added.push(value);
    }
    for (const value of beforeSet) {
      if (!afterSet.has(value)) removed.push(value);
    }
    return { kind: "set", label, added: added.sort(), removed: removed.sort(), kept: kept.sort(), mono };
  }

  function scalarField(label: string, before: string, after: string, mono = false): Extract<SummaryField, { kind: "scalar" }> {
    return { kind: "scalar", label, before, after, mono };
  }

  function coerceToStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  }

  function summarizeResource(row: ContractDiffRow): SummaryEntry {
    const before = isRecord(row.before) ? row.before : null;
    const after = isRecord(row.after) ? row.after : null;
    const kindLabel = resourceKindLabel(row.kind);
    if (row.change === "Add") {
      const fields: SummaryField[] = [];
      if (after) {
        for (const [label, key] of [["payload", "payload"], ["result", "result"], ["input", "input"], ["output", "output"], ["schema", "schema"], ["keySchema", "keySchema"], ["valueSchema", "valueSchema"]] as const) {
          const a = schemaRefLabel(after, key);
          if (a) fields.push(scalarField(label, "—", a, true));
        }
        const caps = Array.isArray(after.capabilities) ? after.capabilities.filter((v): v is string => typeof v === "string") : [];
        if (caps.length > 0) fields.push(stringSetField("capabilities", [], caps, true));
        const purpose = stringField(after, "purpose");
        if (purpose) fields.push(scalarField("purpose", "—", purpose));
      }
      return { id: row.id, change: "Add", kind: resourceSummaryKind(row.kind), name: row.name, summary: "", fields, breaking: false };
    }
    if (row.change === "Remove") {
      return { id: row.id, change: "Remove", kind: resourceSummaryKind(row.kind), name: row.name, summary: "", fields: [], breaking: false };
    }
    const fields: SummaryField[] = [];
    for (const [label, key] of [["payload", "payload"], ["result", "result"], ["input", "input"], ["output", "output"], ["schema", "schema"], ["keySchema", "keySchema"], ["valueSchema", "valueSchema"]] as const) {
      const b = before ? schemaRefLabel(before, key) : null;
      const a = after ? schemaRefLabel(after, key) : null;
      if (b !== a) fields.push(scalarField(label, b ?? "—", a ?? "—", true));
    }
    const beforeCaps = before && Array.isArray(before.capabilities) ? before.capabilities.filter((v): v is string => typeof v === "string") : [];
    const afterCaps = after && Array.isArray(after.capabilities) ? after.capabilities.filter((v): v is string => typeof v === "string") : [];
    if (beforeCaps.length > 0 || afterCaps.length > 0) {
      const field = stringSetField("capabilities", beforeCaps, afterCaps);
      if (field.added.length + field.removed.length > 0) fields.push(field);
    }
    for (const [label, key] of [["concurrency", "concurrency"], ["maxDeliver", "maxDeliver"], ["ttlMs", "ttlMs"], ["maxValueSizeBytes", "maxValueSizeBytes"], ["history", "history"]] as const) {
      const b = before ? primitiveValue(before, key) : "—";
      const a = after ? primitiveValue(after, key) : "—";
      if (b !== a) fields.push(scalarField(label, b, a, true));
    }
    const beforePurpose = before ? stringField(before, "purpose") : null;
    const afterPurpose = after ? stringField(after, "purpose") : null;
    if (beforePurpose !== afterPurpose) fields.push(scalarField("purpose", beforePurpose ?? "—", afterPurpose ?? "—"));
    const summary = buildChangeSummary(fields);
    return { id: row.id, change: "Change", kind: resourceSummaryKind(row.kind), name: row.name, summary, fields, breaking: false };
  }

  function primitiveValue(record: Record<string, unknown>, key: string): string {
    const field = record[key];
    if (field === undefined || field === null) return "—";
    if (typeof field === "string") return field;
    if (typeof field === "number" || typeof field === "boolean") return String(field);
    return "—";
  }

  function resourceKindLabel(kind: string): string {
    if (kind === "Job") return "background job";
    if (kind === "KV") return "key-value store";
    if (kind === "Store") return "data store";
    if (kind === "State") return "state resource";
    if (kind === "Event consumer") return "event consumer";
    return "resource";
  }

  function resourceSummaryKind(kind: string): SummaryKind {
    if (kind === "Job" || kind === "Event consumer") return "background-job";
    if (kind === "KV" || kind === "Store" || kind === "State") return "storage";
    return "metadata";
  }

  function describeResource(record: Record<string, unknown> | null): string | null {
    if (!record) return null;
    const purpose = stringField(record, "purpose");
    const payload = schemaRefLabel(record, "payload");
    if (purpose) return purpose;
    if (payload) return `processes data of shape ${payload}`;
    return null;
  }

  function summarizeSchema(row: ContractDiffRow): SummaryEntry {
    const before = isRecord(row.before) ? row.before : null;
    const after = isRecord(row.after) ? row.after : null;
    if (row.change === "Add") {
      const fields: SummaryField[] = [];
      if (after) {
        const type = typeof after.type === "string" ? after.type : (isRecord(after.properties) ? "object" : "—");
        fields.push(scalarField("type", "—", type));
        const required = Array.isArray(after.required) ? after.required.filter((v): v is string => typeof v === "string") : [];
        if (required.length > 0) {
          fields.push(stringSetField("required", [], required, true));
        }
        const props = isRecord(after.properties) ? Object.keys(after.properties).sort() : [];
        if (props.length > 0) {
          fields.push(stringSetField("properties", [], props, true));
        }
      }
      return { id: row.id, change: "Add", kind: "data-shape", name: row.name, summary: "", fields, breaking: false };
    }
    if (row.change === "Remove") {
      return { id: row.id, change: "Remove", kind: "data-shape", name: row.name, summary: "", fields: [], breaking: false };
    }
    const diffFields = schemaDiffFields(before as Record<string, unknown>, after as Record<string, unknown>);
    const fields: SummaryField[] = diffFields.map((df) => {
      if (df.beforeSet || df.afterSet) {
        const f = stringSetField(df.label, df.beforeSet ?? [], df.afterSet ?? [], true);
        f.breaking = df.breaking;
        if (df.details) f.details = df.details;
        return f;
      }
      const f = scalarField(df.label, df.before, df.after, df.breaking);
      if (df.details) f.details = df.details;
      return f;
    });
    const summary = buildChangeSummary(fields);
    return { id: row.id, change: "Change", kind: "data-shape", name: row.name, summary, fields, breaking: false };
  }

  function describeSchema(record: Record<string, unknown> | null): string | null {
    if (!record) return null;
    const type = record.type;
    if (typeof type === "string") {
      const required = Array.isArray(record.required) ? record.required.filter((v): v is string => typeof v === "string") : [];
      if (required.length > 0) return `${type} with required fields ${formatList(required)}`;
      return `${type} data shape`;
    }
    if (type === true) return "any data shape";
    if (type === false) return "no data";
    return null;
  }

  function summarizeContractMeta(row: ContractDiffRow): SummaryEntry {
    if (row.kind === "Docs") return summarizeDocs(row);
    const before = isRecord(row.before) ? row.before : null;
    const after = isRecord(row.after) ? row.after : null;
    if (row.change === "Change") {
      const fields: SummaryField[] = [];
      const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
      for (const key of keys) {
        const bv = before?.[key];
        const av = after?.[key];
        if (unknownEquals(bv, av)) continue;
        if (isStringArray(bv) || isStringArray(av)) {
          const field = stringSetField(key, bv ?? [], av ?? [], true);
          fields.push(field);
        } else {
          const bStr = metadataValueSummary(bv);
          const aStr = metadataValueSummary(av);
          fields.push(scalarField(key, bStr, aStr));
        }
      }
      return { id: row.id, change: "Change", kind: "metadata", name: row.name, summary: "", fields, breaking: false };
    }
    if (row.change === "Add") {
      const fields: SummaryField[] = [];
      if (after) {
        for (const [key, value] of Object.entries(after)) {
          if (value === undefined) continue;
          if (isStringArray(value)) {
            fields.push(stringSetField(key, [], value, true));
          } else {
            fields.push(scalarField(key, "—", metadataValueSummary(value)));
          }
        }
      }
      return { id: row.id, change: "Add", kind: "metadata", name: row.name, summary: "", fields, breaking: false };
    }
    if (row.change === "Remove") {
      const fields: SummaryField[] = [];
      if (before) {
        for (const [key, value] of Object.entries(before)) {
          if (value === undefined) continue;
          if (isStringArray(value)) {
            fields.push(stringSetField(key, value, [], true));
          } else {
            fields.push(scalarField(key, metadataValueSummary(value), "—"));
          }
        }
      }
      return { id: row.id, change: "Remove", kind: "metadata", name: row.name, summary: "", fields, breaking: false };
    }
    return { id: row.id, change: row.change, kind: "metadata", name: row.name, summary: "", fields: [], breaking: false };
  }

  function metadataValueSummary(value: unknown): string {
    if (value === undefined || value === null) return "—";
    if (typeof value === "string") return value;
    if (typeof value === "boolean" || typeof value === "number") return String(value);
    if (Array.isArray(value)) {
      const strs = value.map((v) => metadataValueSummary(v));
      return strs.length <= 3 ? strs.join(", ") : `${strs.slice(0, 3).join(", ")}, +${strs.length - 3}`;
    }
    if (isRecord(value)) {
      const entries = Object.entries(value).filter(([, v]) => v !== undefined);
      if (entries.length === 0) return "{}";
      return entries.map(([k, v]) => `${k}: ${metadataValueSummary(v)}`).join(", ");
    }
    return "—";
  }

  function metadataRecordSummary(record: Record<string, unknown>): string {
    const entries = Object.entries(record).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "";
    return entries.map(([k, v]) => `${k}: ${metadataValueSummary(v)}`).join(" · ");
  }

  function summarizeDocs(row: ContractDiffRow): SummaryEntry {
    const before = isRecord(row.before) ? row.before : null;
    const after = isRecord(row.after) ? row.after : null;
    if (row.change === "Add") {
      return { id: row.id, change: "Add", kind: "metadata", name: "docs", summary: "contract documentation added", fields: [], breaking: false };
    }
    if (row.change === "Remove") {
      return { id: row.id, change: "Remove", kind: "metadata", name: "docs", summary: "", fields: [], breaking: false };
    }
    const fields: SummaryField[] = [];
    const beforeSummary = before ? stringField(before, "summary") : null;
    const afterSummary = after ? stringField(after, "summary") : null;
    if (beforeSummary !== afterSummary) {
      const shortened = afterSummary && afterSummary.length > 80 ? `${afterSummary.slice(0, 77)}…` : afterSummary;
      fields.push(scalarField("summary", beforeSummary ?? "—", shortened ?? "—"));
    }
    const beforeMarkdown = before ? stringField(before, "markdown") : null;
    const afterMarkdown = after ? stringField(after, "markdown") : null;
    if (beforeMarkdown !== afterMarkdown) {
      const beforeLen = beforeMarkdown?.length ?? 0;
      const afterLen = afterMarkdown?.length ?? 0;
      const beforeDisplay = beforeLen > 40 ? `${beforeMarkdown!.slice(0, 37)}…` : beforeMarkdown ?? "—";
      const afterDisplay = afterLen > 40 ? `${afterMarkdown!.slice(0, 37)}…` : afterMarkdown ?? "—";
      fields.push(scalarField("markdown", beforeDisplay, afterDisplay));
    }
    return { id: row.id, change: "Change", kind: "metadata", name: "docs", summary: "", fields, breaking: false };
  }

  function buildSummary(
    capabilities: ContractDiffRow[],
    surfaces: ContractDiffRow[],
    resources: ContractDiffRow[],
    schemas: ContractDiffRow[],
    contracts: ContractDiffRow[],
  ): SummaryGroup[] {
    const entries: SummaryEntry[] = [];
    for (const row of capabilities) entries.push(summarizeCapability(row));
    for (const row of surfaces) entries.push(summarizeSurface(row));
    for (const row of resources) entries.push(summarizeResource(row));
    for (const row of schemas) entries.push(summarizeSchema(row));
    for (const row of contracts) entries.push(summarizeContractMeta(row));
    const sorted = sortSummary(entries);
    const groups: SummaryGroup[] = [
      { kind: "permission", label: "Permissions", entries: [] },
      { kind: "api", label: "API calls, events, and feeds", entries: [] },
      { kind: "background-job", label: "Background jobs and event consumers", entries: [] },
      { kind: "storage", label: "Storage and state", entries: [] },
      { kind: "data-shape", label: "Data shapes", entries: [] },
      { kind: "metadata", label: "Contract metadata", entries: [] },
    ];
    for (const entry of sorted) {
      const group = groups.find((g) => g.kind === entry.kind);
      if (group) group.entries.push(entry);
    }
    return groups.filter((g) => g.entries.length > 0);
  }

  function sortSummary(entries: SummaryEntry[]): SummaryEntry[] {
    const order: Record<ContractChangeKind, number> = { Add: 0, Change: 1, Remove: 2 };
    return [...entries].sort((a, b) => {
      const aOrder = order[a.change];
      const bOrder = order[b.change];
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.name.localeCompare(b.name);
    });
  }

  function kindLabel(kind: SummaryKind): string {
    if (kind === "permission") return "Permission";
    if (kind === "api") return "API";
    if (kind === "data-shape") return "Data shape";
    if (kind === "background-job") return "Background job";
    if (kind === "storage") return "Storage";
    return "Metadata";
  }

  type DiffHunk = {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  };
  type JsonDiff = {
    hunks: DiffHunk[];
    beforeLines: string[];
    afterLines: string[];
    additions: number;
    deletions: number;
  };
  type DiffRow =
    | { kind: "header"; hunkIndex: number; hunk: DiffHunk }
    | { kind: "line"; hunkIndex: number; lineIndex: number; line: string; beforeLine: number | null; afterLine: number | null }
    | { kind: "gap"; gapIndex: number; beforeStart: number; beforeCount: number; afterStart: number; afterCount: number };

  function buildJsonDiff(before: unknown, after: unknown): JsonDiff {
    const beforeLines = before === undefined || before === null ? [] : stableStringify(before, 2).split("\n");
    const afterLines = after === undefined || after === null ? [] : stableStringify(after, 2).split("\n");
    if (before === undefined || before === null) {
      return { hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: afterLines.length, lines: afterLines.map((l) => `+${l}`) }], beforeLines, afterLines, additions: afterLines.length, deletions: 0 };
    }
    if (after === undefined || after === null) {
      return { hunks: [{ oldStart: 1, oldLines: beforeLines.length, newStart: 0, newLines: 0, lines: beforeLines.map((l) => `-${l}`) }], beforeLines, afterLines, additions: 0, deletions: beforeLines.length };
    }
    const beforeText = beforeLines.join("\n");
    const afterText = afterLines.join("\n");
    const patch = structuredPatch("contract.json", "contract.json", beforeText, afterText, undefined, undefined, { context: 0 });
    let additions = 0;
    let deletions = 0;
    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
        else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
      }
    }
    return { hunks: patch.hunks, beforeLines, afterLines, additions, deletions };
  }

  function buildDiffRows(diff: JsonDiff, context: number): DiffRow[] {
    const rows: DiffRow[] = [];
    let gapIndex = 0;
    const hunks = diff.hunks;
    for (let h = 0; h < hunks.length; h += 1) {
      const hunk = hunks[h];
      const prev = h === 0 ? null : hunks[h - 1];
      const beforeStart = prev === null ? 1 : prev.oldStart + prev.oldLines;
      const afterStart = prev === null ? 1 : prev.newStart + prev.newLines;
      const skippedBefore = hunk.oldStart - beforeStart;
      const skippedAfter = hunk.newStart - afterStart;
      if (skippedBefore > 0 || skippedAfter > 0) {
        if (skippedBefore > 2 * context) {
          rows.push({ kind: "gap", gapIndex, beforeStart: beforeStart + context, beforeCount: skippedBefore - 2 * context, afterStart: afterStart + context, afterCount: skippedAfter - 2 * context });
          gapIndex += 1;
        } else {
          for (let i = 0; i < skippedBefore; i += 1) {
            const beforeLineIdx = beforeStart - 1 + i;
            const afterLineIdx = afterStart - 1 + i;
            const text = diff.beforeLines[beforeLineIdx] ?? "";
            rows.push({ kind: "line", hunkIndex: h, lineIndex: -1, line: ` ${text}`, beforeLine: beforeLineIdx + 1, afterLine: afterLineIdx + 1 });
          }
        }
      }
      rows.push({ kind: "header", hunkIndex: h, hunk });
      for (let li = 0; li < hunk.lines.length; li += 1) {
        rows.push(makeLineRow(h, li, hunk));
      }
    }
    return rows;
  }

  function makeLineRow(hunkIndex: number, lineIndex: number, hunk: DiffHunk): DiffRow {
    const line = hunk.lines[lineIndex];
    const sign = lineSignChar(line);
    const beforeCount = hunk.oldStart + countBefore(hunk, lineIndex);
    const afterCount = hunk.newStart + countAfter(hunk, lineIndex);
    const beforeLine = sign !== "+" ? beforeCount : null;
    const afterLine = sign !== "-" ? afterCount : null;
    return { kind: "line", hunkIndex, lineIndex, line, beforeLine, afterLine };
  }

  function gapLines(diff: JsonDiff, gap: Extract<DiffRow, { kind: "gap" }>): { lines: string[]; beforeLine: number; afterLine: number }[] {
    const result: { lines: string[]; beforeLine: number; afterLine: number }[] = [];
    for (let i = 0; i < gap.beforeCount; i += 1) {
      const beforeIdx = gap.beforeStart - 1 + i;
      const afterIdx = gap.afterStart - 1 + i;
      const text = diff.beforeLines[beforeIdx] ?? "";
      result.push({ lines: [` ${text}`], beforeLine: beforeIdx + 1, afterLine: afterIdx + 1 });
    }
    return result;
  }

  function stableStringify(value: unknown, indent: number): string {
    return JSON.stringify(sortKeys(value), null, indent);
  }

  function sortKeys(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(sortKeys);
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }

  function lineSignChar(line: string): "+" | "-" | " " {
    if (line.startsWith("+")) return "+";
    if (line.startsWith("-")) return "-";
    return " ";
  }

  function lineText(line: string): string {
    return line.slice(1);
  }

  function countBefore(hunk: DiffHunk, lineIndex: number): number {
    let count = 0;
    for (let i = 0; i < lineIndex; i += 1) {
      if (lineSignChar(hunk.lines[i]) !== "+") count += 1;
    }
    return count;
  }

  function countAfter(hunk: DiffHunk, lineIndex: number): number {
    let count = 0;
    for (let i = 0; i < lineIndex; i += 1) {
      if (lineSignChar(hunk.lines[i]) !== "-") count += 1;
    }
    return count;
  }

  function previousContractDigest(value: DeploymentAuthorityPlan): string | null {
    const summary = value.proposal.summary;
    if (!isRecord(summary)) return null;
    const digest = summary.previousContractDigest;
    return typeof digest === "string" && digest.length > 0 ? digest : null;
  }

  function contractDetail(value: unknown): ContractDetail | null {
    return isRecord(value) && typeof value.id === "string" && value.id.length > 0 ? value as ContractDetail : null;
  }

  function toPlan(proposal: AuthDeploymentAuthorityPlansGetOutput["proposal"]): DeploymentAuthorityPlan {
    const common = {
      planId: proposal.proposalId,
      deploymentId: proposal.subjectId,
      proposal: {
        contractId: proposal.participantId,
        contractDigest: proposal.participantArtifactDigest,
        deploymentId: proposal.subjectId,
        requestedNeeds: { contracts: [], surfaces: [], capabilities: proposal.proposedCapabilities.map((capability) => ({ capability, required: true })), resources: [] },
        providedSurfaces: [],
        contract: { id: proposal.participantId },
        summary: { reasons: proposal.reasons },
      },
      desiredChange: {
        capabilities: proposal.proposedCapabilities.map((capability) => ({ capability, required: true })),
        contracts: [],
        resources: [],
        surfaces: [],
      },
      materializationPreview: { permissions: proposal.proposedGrantSet.permissions },
      breakingChanges: [],
      createdAt: new Date(proposal.createdAt).toISOString(),
      expiresAt: proposal.expiresAt ? new Date(proposal.expiresAt).toISOString() : undefined,
      state: proposal.state,
      decisionAt: proposal.decisionAt ? new Date(proposal.decisionAt).toISOString() : null,
      decisionBy: proposal.decisionBy ? { id: proposal.decisionBy } : null,
      decisionReason: proposal.decisionReason,
    };
    return proposal.classification === "migration"
      ? { ...common, classification: "migration", acknowledgementRequired: true }
      : { ...common, classification: "update" };
  }

  async function previousContractFor(value: DeploymentAuthorityPlan): Promise<ContractDetail | null> {
    return null;
  }

  function withTimeout<T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (cause) => { clearTimeout(timer); reject(cause); },
      );
    });
  }

  async function load(clearNotice = true) {
    loading = true;
    error = null;
    previousContract = null;
    if (clearNotice) notice = null;
    try {
      const response = await withTimeout(
        trellis.authDeploymentAuthorityPlansGet({ proposalId: planId }).take(),
        15000,
        "Loading the plan timed out.",
      );
      if (isErr(response)) { error = { kind: "load", message: errorMessage(response) }; return; }
      plan = toPlan(response.proposal);
      previousContract = await withTimeout(
        previousContractFor(plan),
        15000,
        "Loading the previous contract timed out.",
      );
      const authorityResponse = await withTimeout(
        trellis.authDeploymentAuthorityList({ limit: 100 }).take(),
        15000,
        "Loading the deployment authority timed out.",
      );
      authorityKind = isErr(authorityResponse)
        ? null
        : authorityResponse.entries.find((authority) => authority.deploymentId === plan?.deploymentId)?.materialization?.participantKind === "service"
        ? "service"
        : "device";
    } catch (cause) {
      error = { kind: "load", message: errorMessage(cause) };
    } finally {
      loading = false;
    }
  }

  async function acceptUpdate() {
    const currentPlan = plan;
    if (!currentPlan || currentPlan.classification !== "update") return;
    await runDecision(
      () => trellis.authDeploymentAuthorityAcceptUpdate({
        proposalId: currentPlan.planId,
        expectedBaseAuthorityVersion: null,
        idempotencyKey: ulid(),
        reason: null,
      }).take(),
      "Contract applied.",
    );
  }

  async function acceptMigration() {
    const currentPlan = plan;
    if (!currentPlan || currentPlan.classification !== "migration" || !migrationAcknowledged) return;
    await runDecision(
      () => trellis.authDeploymentAuthorityAcceptMigration({
        proposalId: currentPlan.planId,
        expectedBaseAuthorityVersion: null,
        idempotencyKey: ulid(),
        reason: `Reviewed migration of ${currentPlan.proposal.contractId}.`,
      }).take(),
      "Migration applied.",
    );
  }

  async function rejectPlan() {
    const currentPlan = plan;
    if (!currentPlan || !rejectReady) return;
    const trimmedDetails = rejectDetails.trim();
    const reason = trimmedDetails.length > 0 ? `${rejectReason.trim()}: ${trimmedDetails}` : rejectReason.trim();
    await runDecision(
      () => trellis.authDeploymentAuthorityReject({ proposalId: currentPlan.planId, idempotencyKey: ulid(), reason }).take(),
      "Contract rejected.",
    );
  }

  function openDeployment(deploymentId: string) {
    if (authorityKind === "service") {
      void goto(resolve("/(app)/admin/services/[deploymentId]", { deploymentId }));
      return;
    }
    if (authorityKind === "device") {
      void goto(resolve("/admin/devices"));
      return;
    }
    void goto(resolve("/admin/authority/plans"));
  }

  async function runDecision(action: () => Promise<unknown | Result<never, BaseError>>, message: string) {
    acting = true;
    error = null;
    notice = null;
    try {
      const response = await action();
      if (isErr(response)) { error = { kind: "decision", message: errorMessage(response) }; return; }
      notice = message;
      await load(false);
    } catch (cause) {
      error = { kind: "decision", message: errorMessage(cause) };
    } finally {
      acting = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

{#if error}
  <Notice variant="error" class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <div class="font-medium">{error.kind === "load" ? "Failed to load authority plan" : "Failed to update authority plan"}</div>
      <div class="mt-1 text-sm">{error.message}</div>
    </div>
    {#if error.kind === "load"}
      <button class="btn btn-sm" onclick={() => void load()} disabled={loading}>Retry</button>
    {/if}
  </Notice>
{/if}
{#if notice}<Notice variant="success">{notice}</Notice>{/if}

{#if loading}
  <Panel><LoadingState label="Loading authority plan" /></Panel>
{:else if !plan}
  <Panel>
    <div class="text-sm text-base-content/70">This authority plan is unavailable. It may have expired, been accepted elsewhere, or been deleted.</div>
  </Panel>
{:else}
  {#if unmatchedBreaking.length > 0}
    <Notice variant="warning">
      <div class="min-w-0">
        <ul class="mt-2 list-disc pl-4 text-sm">
          {#each unmatchedBreaking as change (`${change.kind}:${change.target.kind}:${change.reason}`)}<li>{change.reason}</li>{/each}
        </ul>
      </div>
    </Notice>
  {/if}

  <div class="mt-4 border-b border-base-300">
    <div role="tablist" class="-mb-px flex gap-1">
      <button
        role="tab"
        type="button"
        class={[
          "border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          activeTab === "summary"
            ? "border-primary text-base-content"
            : "border-transparent text-base-content/60 hover:text-base-content",
        ]}
        aria-selected={activeTab === "summary"}
        onclick={() => (activeTab = "summary")}
      >
        Summary
      </button>
      <button
        role="tab"
        type="button"
        class={[
          "border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          activeTab === "full"
            ? "border-primary text-base-content"
            : "border-transparent text-base-content/60 hover:text-base-content",
        ]}
        aria-selected={activeTab === "full"}
        onclick={() => (activeTab = "full")}
      >
        Full diff
      </button>
    </div>
  </div>

  <div class="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
    <div class="min-w-0">
      {#if activeTab === "summary"}
        <div in:fade={{ duration: 200, easing: cubicOut }} out:fade={{ duration: 100 }}>
        <Panel title="Contract changes" class="min-w-0">
          {#if annotatedSummary.groups.length === 0}
            <p class="text-sm text-base-content/60">No contract changes proposed. The proposed contract matches the previous accepted contract.</p>
          {:else}
            <div class="divide-y divide-base-200">
              {#each annotatedSummary.groups as group (group.kind)}
                {@const groupBreaking = group.entries.filter((e) => e.breaking).length}
                <div class="border-b border-base-300 bg-base-300/15 px-1 py-2">
                  <div class="text-xs font-semibold uppercase tracking-wide text-base-content/70">{group.label}</div>
                  <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="badge badge-ghost badge-sm">{group.entries.length} {group.entries.length === 1 ? "change" : "changes"}</span>
                    {#if groupBreaking > 0}
                      <span class="badge badge-error badge-sm">{groupBreaking} breaking</span>
                    {/if}
                  </div>
                </div>
                {#each group.entries as entry (entry.id)}
                  <div class={["grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-1 py-2", entry.breaking ? "bg-error/15" : ""]}>
                    <div class="row-span-2 flex items-center justify-center">
                      {#if entry.change === "Add"}
                        <Icon name="plus" size={16} class="text-success" />
                      {:else if entry.change === "Remove"}
                        <Icon name="minus" size={16} class="text-error" />
                      {:else}
                        <Icon name="pencil" size={16} class="text-info" />
                      {/if}
                    </div>
                    <div class="flex flex-wrap items-baseline gap-2">
                      <code class={["trellis-identifier !whitespace-normal !break-all", entry.breaking ? "font-bold" : "font-semibold"]}>{entry.name}</code>
                      <span class="text-xs text-base-content/55">{kindLabel(entry.kind)}</span>
                      {#if entry.breaking}
                        <span class="badge badge-error badge-outline badge-sm">Breaking</span>
                      {/if}
                    </div>
                    <div class="min-w-0">
                      {#if entry.fields.length > 0}
                        <div class="space-y-1.5">
                          {#each entry.fields as field, fieldIndex (fieldIndex)}
                            {#if field.kind === "set"}
                              <div class="text-xs">
                                <span class="font-semibold text-base-content/70">{field.label}:</span>
                                <span class="ml-1 inline-flex flex-wrap gap-1 align-middle">
                                  {#each field.removed as value (value)}<span class={["badge badge-error badge-sm gap-1 px-1.5", field.mono ? "trellis-identifier" : ""]}><Icon name="minus" size={10} />{value}</span>{/each}
                                  {#each field.added as value (value)}<span class={["badge badge-success badge-sm gap-1 px-1.5", field.mono ? "trellis-identifier" : ""]}><Icon name="plus" size={10} />{value}</span>{/each}
                                  {#each field.kept as value (value)}<span class={["badge badge-ghost badge-sm opacity-60", field.mono ? "trellis-identifier" : ""]}>{value}</span>{/each}
                                </span>
                                {#if field.details && field.details.length > 0}
                                  {@const detailKey = `${entry.id}-${fieldIndex}`}
                                  <button
                                    type="button"
                                    class="link link-hover text-base-content/50 text-[10px] ml-1"
                                    onclick={() => { expandedDetails = expandedDetails.has(detailKey) ? new Set([...expandedDetails].filter(k => k !== detailKey)) : new Set([...expandedDetails, detailKey]); }}
                                  >
                                    {expandedDetails.has(detailKey) ? "hide" : `${field.details.length} detail${field.details.length > 1 ? "s" : ""}`}
                                  </button>
                                {/if}
                              </div>
                              {#if field.details && field.details.length > 0 && expandedDetails.has(`${entry.id}-${fieldIndex}`)}
                                <div class="ml-4 mt-1 space-y-0.5 border-l border-base-300 pl-2">
                                  {#each field.details as detail (detail)}
                                    <div class="text-[11px] text-base-content/60">
                                      <span class="font-medium">{detail.label}:</span>
                                      {#if detail.before === "—"}
                                        <span class="text-success">{detail.after}</span>
                                      {:else}
                                        <span class="text-error line-through">{detail.before}</span>
                                        <span class="text-base-content/40">→</span>
                                        <span class="text-success">{detail.after}</span>
                                      {/if}
                                    </div>
                                  {/each}
                                </div>
                              {/if}
                            {:else}
                              <div class="flex flex-wrap items-baseline gap-x-1.5 text-xs">
                                <span class="font-semibold text-base-content/70 shrink-0">{field.label}:</span>
                                <span class={field.mono ? "trellis-identifier !whitespace-normal !break-all text-error line-through" : "break-all text-error line-through"}>{field.before}</span>
                                <span class="shrink-0 text-base-content/40">→</span>
                                <span class={field.mono ? "trellis-identifier !whitespace-normal !break-all text-success" : "break-all text-success"}>{field.after}</span>
                                {#if field.details && field.details.length > 0}
                                  {@const detailKey = `${entry.id}-${fieldIndex}`}
                                  <button
                                    type="button"
                                    class="link link-hover text-base-content/50 text-[10px] ml-1"
                                    onclick={() => { expandedDetails = expandedDetails.has(detailKey) ? new Set([...expandedDetails].filter(k => k !== detailKey)) : new Set([...expandedDetails, detailKey]); }}
                                  >
                                    {expandedDetails.has(detailKey) ? "hide" : `${field.details.length} detail${field.details.length > 1 ? "s" : ""}`}
                                  </button>
                                {/if}
                              </div>
                              {#if field.details && field.details.length > 0 && expandedDetails.has(`${entry.id}-${fieldIndex}`)}
                                <div class="ml-4 mt-1 space-y-0.5 border-l border-base-300 pl-2">
                                  {#each field.details as detail (detail)}
                                    <div class="text-[11px] text-base-content/60">
                                      <span class="font-medium">{detail.label}:</span>
                                      {#if detail.before === "—" || detail.after === "—"}
                                        <span class={detail.before === "—" ? "text-success" : "text-error line-through"}>{detail.before === "—" ? detail.after : detail.before}</span>
                                      {:else}
                                        <span class="text-error line-through">{detail.before}</span>
                                        <span class="text-base-content/40">→</span>
                                        <span class="text-success">{detail.after}</span>
                                      {/if}
                                    </div>
                                  {/each}
                                </div>
                              {/if}
                            {/if}
                          {/each}
                        </div>
                      {:else if entry.summary}
                        <div class="text-sm text-base-content/80">{entry.summary}</div>
                      {:else}
                        <span class="text-xs text-base-content/40">—</span>
                      {/if}
                    </div>
                  </div>
                {/each}
              {/each}
            </div>
          {/if}
        </Panel>
        </div>
      {:else}
        <div in:fade={{ duration: 200, easing: cubicOut }} out:fade={{ duration: 100 }}>
        <Panel title="Full contract diff" class="min-w-0">
          {#if diffRows.length === 0}
            <p class="text-sm text-base-content/60">No contract changes proposed. The proposed contract matches the previous accepted contract.</p>
          {:else}
            <div class="mb-2 flex flex-wrap items-center gap-3 text-xs text-base-content/60">
              <span class="font-mono">{jsonDiff.additions} added</span>
              <span class="font-mono">{jsonDiff.deletions} removed</span>
              <span class="font-mono">{jsonDiff.hunks.length} hunk{jsonDiff.hunks.length === 1 ? "" : "s"}</span>
              <span class="grow"></span>
              {#if allGapsExpanded}
                <button class="btn btn-ghost btn-xs gap-1" onclick={collapseAllGaps}><Icon name="minus" size={12} />Collapse all</button>
              {:else}
                <button class="btn btn-ghost btn-xs gap-1" onclick={expandAllGaps}><Icon name="plus" size={12} />Expand all {gapCount} gaps</button>
              {/if}
            </div>
            <div class="rounded border border-base-300 bg-base-200/30 text-xs">
              <table class="w-full font-mono leading-relaxed">
                <colgroup>
                  <col class="w-10" />
                  <col />
                  <col class="w-3" />
                  <col />
                  <col class="w-10" />
                </colgroup>
                <tbody>
                  {#each diffRows as row, index (index)}
                    {#if row.kind === "header"}
                      <tr class="bg-base-300/40">
                        <td colspan="5" class="px-2 py-1 text-base-content/60">@@ -{row.hunk.oldStart},{row.hunk.oldLines} +{row.hunk.newStart},{row.hunk.newLines} @@</td>
                      </tr>
                    {:else if row.kind === "line"}
                      {@const sign = lineSignChar(row.line)}
                      <tr class={sign === "+" ? "bg-success/15" : sign === "-" ? "bg-error/15" : ""}>
                        <td class="select-none border-r border-base-300/60 px-2 py-0.5 text-right text-base-content/40">{row.beforeLine ?? ""}</td>
                        <td class={"px-2 py-0.5 whitespace-pre-wrap break-all border-r border-base-300/60 " + (sign === "-" ? "text-error" : "text-base-content/80")}>
                          {#if sign !== "+"}{lineText(row.line)}{/if}
                        </td>
                        <td class={"select-none px-1 py-0.5 text-center " + (sign === "+" ? "text-success" : sign === "-" ? "text-error" : "text-base-content/30")}>
                          {sign === "+" ? "+" : sign === "-" ? "−" : ""}
                        </td>
                        <td class={"px-2 py-0.5 whitespace-pre-wrap break-all border-l border-base-300/60 " + (sign === "+" ? "text-success" : "text-base-content/80")}>
                          {#if sign !== "-"}{lineText(row.line)}{/if}
                        </td>
                        <td class="select-none border-l border-base-300/60 px-2 py-0.5 text-right text-base-content/40">{row.afterLine ?? ""}</td>
                      </tr>
                    {:else}
                      {@const expanded = isGapExpanded(row.gapIndex)}
                      <tr class="bg-base-300/30 hover:bg-base-300/50">
                        <td colspan="5" class="px-2 py-1 text-center text-base-content/60">
                          <button type="button" class="w-full cursor-pointer" onclick={() => toggleGap(row.gapIndex)}>
                            {#if expanded}
                              <span>− collapse {row.beforeCount} unchanged line{row.beforeCount === 1 ? "" : "s"}</span>
                            {:else}
                              <span>⋯ expand {row.beforeCount} unchanged line{row.beforeCount === 1 ? "" : "s"} (lines {row.beforeStart}–{row.beforeStart + row.beforeCount - 1})</span>
                            {/if}
                          </button>
                        </td>
                      </tr>
                      {#if expanded}
                        {#each gapLines(jsonDiff, row) as gapLine, gapLineIndex (gapLineIndex)}
                          <tr class="" in:fade={{ duration: 150, delay: gapLineIndex * 15, easing: cubicOut }}>
                            <td class="select-none border-r border-base-300/60 px-2 py-0.5 text-right text-base-content/40">{gapLine.beforeLine}</td>
                            <td class="px-2 py-0.5 whitespace-pre-wrap break-all border-r border-base-300/60 text-base-content/80">{lineText(gapLine.lines[0])}</td>
                            <td class="select-none px-1 py-0.5 text-center text-base-content/30"></td>
                            <td class="px-2 py-0.5 whitespace-pre-wrap break-all border-l border-base-300/60 text-base-content/80">{lineText(gapLine.lines[0])}</td>
                            <td class="select-none border-l border-base-300/60 px-2 py-0.5 text-right text-base-content/40">{gapLine.afterLine}</td>
                          </tr>
                        {/each}
                      {/if}
                    {/if}
                  {/each}
                </tbody>
              </table>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-3 text-xs text-base-content/60">
              <span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded-sm bg-success/15"></span>added</span>
              <span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded-sm bg-error/15"></span>removed</span>
              <span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded-sm bg-base-100 ring-1 ring-base-300"></span>unchanged</span>
            </div>
          {/if}
        </Panel>
        </div>
      {/if}
    </div>

    <div class="min-w-0 self-start xl:sticky xl:top-4">
      <Panel title={pending ? "Decision" : "Decision record"} class="min-w-0">
      {#if plan}
        <div class="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span class="text-xs uppercase tracking-wide text-base-content/55">For Deployment</span>
          <span class="text-base-content/40">·</span>
          {#if authorityKind === "service"}
            <a class="link link-hover font-mono font-semibold" href={resolve("/(app)/admin/services/[deploymentId]", { deploymentId: plan.deploymentId })}>{plan.deploymentId}</a>
          {:else if authorityKind === "device"}
            <a class="link link-hover font-mono font-semibold" href={resolve("/admin/devices")}>{plan.deploymentId}</a>
          {:else}
            <code class="trellis-identifier font-semibold">{plan.deploymentId}</code>
          {/if}
        </div>
      {/if}
      <div class="mb-3 flex flex-wrap items-stretch gap-3 rounded-box border border-base-300 bg-base-100 p-3">
        <div class="flex flex-1 min-w-28 flex-col items-center justify-center text-center">
          <div class="text-xs uppercase tracking-wide text-base-content/55">Changes</div>
          <div class="mt-1 text-4xl font-semibold leading-none">{summaryEntryCount}</div>
        </div>
        <div class="w-px self-stretch bg-base-300"></div>
        <div class={["flex flex-1 min-w-28 flex-col items-center justify-center rounded-md px-3 py-2 text-center", summaryBreakingCount > 0 ? "bg-error/10" : "bg-base-200/40"]}>
          <div class={["text-xs uppercase tracking-wide", summaryBreakingCount > 0 ? "text-error" : "text-base-content/55"]}>Breaking</div>
          <div class={["mt-1 text-4xl font-semibold leading-none", summaryBreakingCount > 0 ? "text-error" : "text-base-content/60"]}>{summaryBreakingCount}</div>
        </div>
      </div>
      {#if pending}
        {#if isMigration}
          <Notice variant="info">
            <div>
              <div class="font-semibold">Migration required</div>
              <div class="mt-1 text-sm break-words">This is a migration. Existing data or call sites may not be compatible with the new version. Review the changes, then accept to apply.</div>
            </div>
          </Notice>
          <label class="mt-3 flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" class="checkbox checkbox-sm mt-0.5 shrink-0" bind:checked={acknowledgeChecked} />
            <span class="min-w-0 break-words">I have reviewed the changes and acknowledge this may break existing services and users.</span>
          </label>
          <div class="mt-3 flex flex-wrap gap-2">
            <button class="btn btn-sm btn-primary" onclick={acceptMigration} disabled={acting || !migrationAcknowledged}>Accept migration</button>
          </div>
        {:else}
          <p class="text-sm text-base-content/70 break-words">Accepting will deploy this contract as the new configuration for <code class="trellis-identifier !whitespace-normal !break-all">{plan.deploymentId}</code>.</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button class="btn btn-sm btn-primary" onclick={acceptUpdate} disabled={acting}>Accept update</button>
          </div>
        {/if}
        <div class="mt-4 space-y-2 border-t border-base-300 pt-4 text-sm">
          <div class="text-sm font-semibold">Reject with a reason</div>
          <label class="form-control block">
            <span class="label py-1 text-xs text-base-content/60">Reason *</span>
            <select class="select select-bordered select-sm w-full" bind:value={rejectReason}>
              <option value="">Select a reason</option>
              <option value="breaking_change_unintended">Breaking change not intended</option>
              <option value="security_concern">Security or permission concern</option>
              <option value="needs_review">Needs additional review</option>
              <option value="wrong_version">Wrong contract version</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label class="form-control block">
            <span class="label py-1 text-xs text-base-content/60">Details (optional)</span>
            <textarea class="textarea textarea-bordered min-h-20 w-full" bind:value={rejectDetails} placeholder="Add any additional details..."></textarea>
          </label>
          <button class="btn btn-sm btn-error btn-outline w-full" onclick={rejectPlan} disabled={acting || !rejectReady}>Reject</button>
        </div>
      {:else}
        <p class="text-sm text-base-content/60">This plan is no longer actionable.</p>
      {/if}
      </Panel>
    </div>
  </div>
{/if}
