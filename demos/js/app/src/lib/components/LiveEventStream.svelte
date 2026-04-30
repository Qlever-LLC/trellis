<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { ok } from "@qlever-llc/result";
  import { getTrellis } from "$lib/trellis";
  import { formatDateTimeWithAge } from "$lib/format";

  type ActivityRecordedEvent = {
    activityId: string;
    kind: string;
    message: string;
    occurredAt: string;
  };
  type ReportsPublishedEvent = {
    reportId: string;
    inspectionId: string;
    publishedAt: string;
  };
  type SitesRefreshedEvent = {
    refreshId: string;
    site: { siteId?: string; siteName: string; latestStatus: string };
    refreshedAt: string;
  };
  type OperationName = "Sites.Refresh" | "Reports.Generate";
  type LiveEventKind = "event" | "operation" | "external-job";
  type LiveEvent = {
    id: string;
    kind: LiveEventKind;
    name: "Activity.Recorded" | "Reports.Published" | "Sites.Refreshed" | OperationName;
    action: string;
    subject: string;
    occurredAt: string;
    operationId?: string;
    refreshId?: string;
    inspectionId?: string;
    state?: string;
  };
  type OperationGroup = {
    kind: "operation-group";
    id: string;
    operationId: string;
    name: OperationName;
    latestAction: string;
    latestState: string;
    latestOccurredAt: string;
    children: LiveEvent[];
  };
  type StreamDisplayItem = LiveEvent | OperationGroup;
  type GroupedOperationLiveEvent = Omit<LiveEvent, "name" | "operationId"> & { name: OperationName; operationId: string };
  type LocalOperationUpdate = {
    kind: "operation" | "external-job";
    id: string;
    operationId: string;
    name: OperationName;
    action: string;
    subject: string;
    state: string;
    occurredAt: string;
    jobId?: string;
    refreshId?: string;
    inspectionId?: string;
  };

  const trellis = getTrellis();

  let listening = $state(false);
  let starting = $state(false);
  let error = $state<string | null>(null);
  let liveEvents = $state<LiveEvent[]>([]);
  let controller: AbortController | null = null;
  let mounted = false;
  let localUpdateListener: EventListener | null = null;
  let activeRefreshOperationId: string | null = null;
  let activeReportOperation: { operationId: string; inspectionId?: string } | null = null;

  function isActivityRecordedEvent(value: unknown): value is ActivityRecordedEvent {
    return typeof value === "object" && value !== null &&
      "activityId" in value && typeof value.activityId === "string" &&
      "kind" in value && typeof value.kind === "string" &&
      "message" in value && typeof value.message === "string" &&
      "occurredAt" in value && typeof value.occurredAt === "string";
  }

  function isReportsPublishedEvent(value: unknown): value is ReportsPublishedEvent {
    return typeof value === "object" && value !== null &&
      "reportId" in value && typeof value.reportId === "string" &&
      "inspectionId" in value && typeof value.inspectionId === "string" &&
      "publishedAt" in value && typeof value.publishedAt === "string";
  }

  function isSitesRefreshedEvent(value: unknown): value is SitesRefreshedEvent {
    return typeof value === "object" && value !== null &&
      "refreshId" in value && typeof value.refreshId === "string" &&
      "refreshedAt" in value && typeof value.refreshedAt === "string" &&
      "site" in value && typeof value.site === "object" && value.site !== null &&
      "siteName" in value.site && typeof value.site.siteName === "string" &&
      "latestStatus" in value.site && typeof value.site.latestStatus === "string";
  }

  function isLocalOperationUpdate(value: unknown): value is LocalOperationUpdate {
    return typeof value === "object" && value !== null &&
      "kind" in value && (value.kind === "operation" || value.kind === "external-job") &&
      "id" in value && typeof value.id === "string" &&
      "operationId" in value && typeof value.operationId === "string" &&
      "name" in value && (value.name === "Sites.Refresh" || value.name === "Reports.Generate") &&
      "action" in value && typeof value.action === "string" &&
      "subject" in value && typeof value.subject === "string" &&
      "state" in value && typeof value.state === "string" &&
      "occurredAt" in value && typeof value.occurredAt === "string" &&
      (!("jobId" in value) || typeof value.jobId === "string") &&
      (!("refreshId" in value) || typeof value.refreshId === "string") &&
      (!("inspectionId" in value) || typeof value.inspectionId === "string");
  }

  function isOperationName(name: string): name is OperationName {
    return name === "Sites.Refresh" || name === "Reports.Generate";
  }

  function isGroupedOperationUpdate(event: LiveEvent): event is GroupedOperationLiveEvent {
    return isOperationName(event.name) && Boolean(event.operationId);
  }

  function addEvent(event: LiveEvent): void {
    if (!mounted) return;
    liveEvents = [event, ...liveEvents].slice(0, 24);
  }

  let displayItems = $derived.by((): StreamDisplayItem[] => {
    const jobOperationIds: Record<string, string> = {};
    for (const event of liveEvents) {
      if (event.name === "Sites.Refresh" && event.kind === "external-job" && event.operationId) {
        jobOperationIds[event.refreshId ?? event.subject] = event.operationId;
      }
    }

    type DisplayBlock = { occurredAt: string; items: StreamDisplayItem[] };

    const groups: Record<string, OperationGroup> = {};
    const relatedEvents: Record<string, LiveEvent[]> = {};
    const standaloneBlocks: DisplayBlock[] = [];

    for (const event of liveEvents) {
      const relatedOperationId = event.name === "Sites.Refreshed" && event.refreshId
        ? jobOperationIds[event.refreshId]
        : event.operationId;

      if (isGroupedOperationUpdate(event)) {
        let group = groups[event.operationId];
        if (!group) {
          group = {
            kind: "operation-group",
            id: `operation-${event.operationId}`,
            operationId: event.operationId,
            name: event.name,
            latestAction: event.action,
            latestState: event.state ?? "event",
            latestOccurredAt: event.occurredAt,
            children: [],
          };
          groups[event.operationId] = group;
        }
        group.children.push(event);
      } else if (relatedOperationId) {
        relatedEvents[relatedOperationId] = [
          ...(relatedEvents[relatedOperationId] ?? []),
          event,
        ];
      } else {
        standaloneBlocks.push({ occurredAt: event.occurredAt, items: [event] });
      }
    }

    const operationBlocks = Object.values(groups).map((group): DisplayBlock => {
      const events = relatedEvents[group.operationId] ?? [];
      const occurredAt = [group.latestOccurredAt, ...events.map((event) => event.occurredAt)]
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? group.latestOccurredAt;
      return { occurredAt, items: [group, ...events] };
    });
    const groupedOperationIds = new Set(Object.keys(groups));
    const orphanRelatedBlocks = Object.entries(relatedEvents)
      .filter(([operationId]) => !groupedOperationIds.has(operationId))
      .flatMap(([, events]) => events.map((event): DisplayBlock => ({ occurredAt: event.occurredAt, items: [event] })));

    return [...operationBlocks, ...orphanRelatedBlocks, ...standaloneBlocks]
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
      .flatMap((block) => block.items);
  });

  function handleLocalOperationUpdate(event: Event): void {
    const detail = event instanceof CustomEvent ? event.detail : null;
    if (!isLocalOperationUpdate(detail)) return;
    const isTerminal = detail.state === "completed" || detail.state === "failed" || detail.state === "cancelled";
    if (detail.name === "Sites.Refresh") {
      activeRefreshOperationId = isTerminal ? null : detail.operationId;
    } else {
      activeReportOperation = detail.state === "failed" || detail.state === "cancelled"
        ? null
        : { operationId: detail.operationId, inspectionId: detail.inspectionId };
    }
    addEvent({
      id: detail.id,
      kind: detail.kind,
      name: detail.name,
      action: detail.action,
      subject: detail.subject,
      occurredAt: detail.occurredAt,
      operationId: detail.operationId,
      refreshId: detail.refreshId ?? detail.jobId,
      inspectionId: detail.inspectionId,
      state: detail.state,
    });
  }

  function operationLabel(name: OperationName): string {
    return name.replace(".", " ");
  }

  function formatEventKind(kind: string): string {
    return kind
      .split(/[-_.\s]+/)
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ") || "Activity";
  }

  function subjectFromActivity(message: string): string {
    const keyMatch = message.match(/(?:from|upload)\s+(evidence\/\S+)/i);
    if (keyMatch) return keyMatch[1]?.split("/").pop() ?? "Evidence upload";
    return message;
  }

  function kindLabel(kind: LiveEventKind): string {
    if (kind === "external-job") return "EXTERNAL JOB";
    if (kind === "operation") return "UPDATE";
    return "EVENT";
  }

  function updateLabel(event: LiveEvent): string {
    if (event.kind === "operation" && event.state === "started") return "STARTED";
    if (event.kind === "operation" && event.state === "completed") return "COMPLETED";
    if (event.kind === "operation" && event.state === "failed") return "FAILED";
    return kindLabel(event.kind);
  }

  function kindBadgeClass(kind: LiveEventKind): string {
    if (kind === "external-job") return "badge badge-accent badge-outline badge-sm max-w-full";
    if (kind === "operation") return "badge badge-secondary badge-outline badge-sm max-w-full";
    return "badge badge-primary badge-outline badge-sm max-w-full";
  }

  async function startListening(): Promise<void> {
    if (listening || starting) return;

    error = null;
    starting = true;
    controller = new AbortController();
    const localController = controller;

    try {
      await trellis.event(
        "Activity.Recorded",
        {},
        (event: unknown) => {
          if (isActivityRecordedEvent(event)) {
            addEvent({
              id: `${event.activityId}-${event.occurredAt}`,
              kind: "event",
              name: "Activity.Recorded",
              action: formatEventKind(event.kind),
              subject: subjectFromActivity(event.message),
              occurredAt: event.occurredAt,
              operationId: event.kind === "site-refreshed" ? activeRefreshOperationId ?? undefined : undefined,
            });
          }
          return ok(undefined);
        },
        { mode: "ephemeral", replay: "new", signal: localController.signal },
      ).orThrow();

      if (!mounted || controller !== localController || localController.signal.aborted) return;

      await trellis.event(
        "Reports.Published",
        {},
        (event: unknown) => {
          if (isReportsPublishedEvent(event)) {
            const relatedOperationId = activeReportOperation && (!activeReportOperation.inspectionId || activeReportOperation.inspectionId === event.inspectionId)
              ? activeReportOperation.operationId
              : undefined;
            addEvent({
              id: `${event.reportId}-${event.publishedAt}`,
              kind: "event",
              name: "Reports.Published",
              action: "Closeout Package Published",
              subject: event.inspectionId,
              occurredAt: event.publishedAt,
              operationId: relatedOperationId,
              inspectionId: event.inspectionId,
            });
            if (relatedOperationId) activeReportOperation = null;
          }
          return ok(undefined);
        },
        { mode: "ephemeral", replay: "new", signal: localController.signal },
      ).orThrow();

      if (!mounted || controller !== localController || localController.signal.aborted) return;

      await trellis.event(
        "Sites.Refreshed",
        {},
        (event: unknown) => {
          if (isSitesRefreshedEvent(event)) {
            addEvent({
              id: `${event.refreshId}-${event.refreshedAt}`,
              kind: "event",
              name: "Sites.Refreshed",
              action: "Site Status Refreshed",
              subject: `${event.site.siteName}: ${event.site.latestStatus}`,
              occurredAt: event.refreshedAt,
              refreshId: event.refreshId,
            });
          }
          return ok(undefined);
        },
        { mode: "ephemeral", replay: "new", signal: localController.signal },
      ).orThrow();

      if (!mounted || controller !== localController || localController.signal.aborted) return;
      listening = true;
    } catch (cause) {
      localController.abort();
      if (controller === localController) controller = null;
      if (!mounted || controller !== null) return;
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (controller === localController || controller === null) {
        starting = false;
      }
    }
  }

  function stopListening(): void {
    controller?.abort();
    controller = null;
    starting = false;
    listening = false;
  }

  onMount(() => {
    mounted = true;
    localUpdateListener = handleLocalOperationUpdate;
    window.addEventListener("trellisoperationupdate", localUpdateListener);
    void startListening();
  });

  onDestroy(() => {
    mounted = false;
    if (localUpdateListener) {
      window.removeEventListener("trellisoperationupdate", localUpdateListener);
      localUpdateListener = null;
    }
    stopListening();
  });
</script>

<section class="live-event-rail flex h-full min-w-0 flex-col gap-4 px-4 py-5" aria-label="Persistent live event stream">
  <header class="space-y-3">
    <div class="flex min-w-0 items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="trellis-kicker">Live stream</p>
        <h2 class="mt-1 break-words text-lg font-black tracking-tight">System loop</h2>
      </div>
      <span class={listening ? "badge badge-success badge-outline max-w-full" : "badge badge-warning badge-outline max-w-full"}>
        <span class="truncate">{listening ? "live" : starting ? "starting" : "offline"}</span>
      </span>
    </div>
  </header>

  <p class="capability-note">
    <strong>Events + operations:</strong> Activity.Recorded + Sites.Refreshed + Reports.Published + Sites.Refresh + Reports.Generate + external jobs
  </p>

  {#if error}
    <div role="alert" class="alert alert-error py-2 text-sm"><span>{error}</span></div>
  {/if}

  <div class="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
    {#if displayItems.length === 0}
      <div class="alert py-3 text-sm">
        <span>Live domain events and operation updates will appear here as the workflow runs.</span>
      </div>
    {:else}
      <div class="divide-y divide-base-300/80 border-y border-base-300/80">
        {#each displayItems as item (item.id)}
          {#if item.kind === "operation-group"}
            <details class="min-w-0 border border-secondary/45 bg-base-200/30" open>
              <summary class="grid cursor-pointer list-none gap-1.5 px-3 py-2.5 text-sm marker:hidden">
                <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span class="flex min-w-0 items-center gap-2">
                    <svg class="collapse-chevron h-3.5 w-3.5 shrink-0 text-base-content/60" aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="m6 4 4 4-4 4" />
                    </svg>
                    <span class="badge badge-secondary badge-outline badge-sm max-w-full"><span class="truncate">OPERATION</span></span>
                  </span>
                  <span class="shrink-0 text-[0.68rem] uppercase tracking-[0.12em] text-base-content/48">{operationLabel(item.name)}</span>
                </div>
                <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h3 class="min-w-0 truncate font-semibold">{item.name}</h3>
                  <span class="min-w-0 truncate text-xs text-base-content/70">{item.latestAction}</span>
                </div>
                <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span class="min-w-0 truncate font-mono text-[0.68rem] uppercase tracking-[0.08em] text-base-content/58">state {item.latestState}</span>
                  <span class="break-words text-[0.68rem] text-base-content/58">{formatDateTimeWithAge(item.latestOccurredAt)}</span>
                </div>
              </summary>
              <div class="divide-y divide-base-300/70 border-t border-base-300/80 pl-7">
                {#each item.children as child (child.id)}
                  <article class="min-w-0 py-2 pl-3 pr-3">
                    <div class="grid min-w-0 gap-1 text-xs">
                      <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span class={kindBadgeClass(child.kind)}><span class="truncate">{updateLabel(child)}</span></span>
                        <h4 class="min-w-0 truncate text-sm font-semibold">{child.action}</h4>
                        {#if child.state && child.kind !== "operation" && child.kind !== "external-job"}
                          <span class="min-w-0 truncate font-mono text-[0.65rem] uppercase tracking-[0.08em] text-base-content/54">state {child.state}</span>
                        {/if}
                      </div>
                      <div class="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[0.68rem] leading-4 text-base-content/58">
                        <span class="min-w-0 truncate">{child.kind === "external-job" ? `Job ID: ${child.subject}` : child.subject}</span>
                        <span class="break-words">{formatDateTimeWithAge(child.occurredAt)}</span>
                      </div>
                    </div>
                  </article>
                {/each}
              </div>
            </details>
          {:else}
            <article class="min-w-0 border border-base-300/80 bg-base-200/30 py-2.5 pl-3 pr-3">
              <div class="grid min-w-0 gap-1.5 text-sm">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <span class={kindBadgeClass(item.kind)}><span class="truncate">{kindLabel(item.kind)}</span></span>
                  <h3 class="min-w-0 truncate font-semibold">{item.action}</h3>
                </div>
                <p class="min-w-0 truncate text-xs leading-5 text-base-content/64">{item.subject}</p>
                <div class="flex min-w-0 flex-wrap items-center justify-between gap-2 text-[0.68rem] text-base-content/58">
                  {#if item.state}
                    <span class="min-w-0 truncate font-mono uppercase tracking-[0.08em]">state {item.state}</span>
                  {/if}
                  <span class="break-words">{formatDateTimeWithAge(item.occurredAt)}</span>
                </div>
              </div>
            </article>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  details[open] .collapse-chevron {
    transform: rotate(90deg);
  }

  .collapse-chevron {
    transition: transform 120ms ease;
  }
</style>
