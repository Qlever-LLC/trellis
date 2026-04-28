<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { ok } from "@qlever-llc/result";
  import { getTrellis } from "$lib/trellis";

  type ActivityRecordedEvent = {
    activityId: string;
    kind: string;
    message: string;
    occurredAt: string;
    relatedSiteId?: string;
    relatedInspectionId?: string;
  };
  type ReportsPublishedEvent = {
    reportId: string;
    inspectionId: string;
    siteId?: string;
    publishedAt: string;
  };
  type LiveEvent = {
    id: string;
    name: "Activity.Recorded" | "Reports.Published";
    title: string;
    detail: string;
    occurredAt: string;
  };

  const trellis = getTrellis();

  let listening = $state(false);
  let starting = $state(false);
  let error = $state<string | null>(null);
  let liveEvents = $state<LiveEvent[]>([]);
  let controller: AbortController | null = null;
  let mounted = false;

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

  function addEvent(event: LiveEvent): void {
    if (!mounted) return;
    liveEvents = [event, ...liveEvents].slice(0, 20);
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
              name: "Activity.Recorded",
              title: event.kind,
              detail: event.message,
              occurredAt: event.occurredAt,
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
            addEvent({
              id: `${event.reportId}-${event.publishedAt}`,
              name: "Reports.Published",
              title: "Report published",
              detail: `${event.reportId} for ${event.inspectionId}`,
              occurredAt: event.publishedAt,
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
      if (controller === localController) {
        controller = null;
      }
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
    void startListening();
  });

  onDestroy(() => {
    mounted = false;
    stopListening();
  });
</script>

<svelte:head>
  <title>Live Feed · Field Inspection Desk</title>
</svelte:head>

<section class="page-sheet rounded-box p-5 sm:p-7">
  <div class="flex flex-col gap-6">
  <header class="pb-1">
    <div class="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div class="min-w-0 space-y-3">
        <div class="trellis-kicker">Event watch</div>
        <h1 class="break-words text-2xl font-black tracking-tight md:text-3xl">Live feed</h1>
        <p class="max-w-3xl break-words text-sm text-base-content/70">
          Keep a live watch on field activity and report publication events as inspection work moves through the desk.
        </p>
      </div>
      <div class="flex min-w-0 flex-wrap gap-3">
        <button class="btn btn-accent btn-sm" onclick={startListening} disabled={listening || starting}>{starting ? "Starting feed..." : "Start feed"}</button>
        <button class="btn btn-outline btn-sm" onclick={stopListening} disabled={!listening && !starting}>Pause feed</button>
        <span class={listening ? "badge badge-success badge-outline badge-lg max-w-full" : "badge badge-warning badge-outline badge-lg max-w-full"}>
          <span class="truncate">{listening ? "live" : starting ? "starting" : "paused"}</span>
        </span>
        <span class="badge badge-outline badge-lg max-w-full"><span class="truncate">Teaching note: events</span></span>
      </div>
    </div>
  </header>

  {#if error}
    <div role="alert" class="alert alert-error"><span>{error}</span></div>
  {/if}

  <section class="section-rule pt-6">
    <div class="flex flex-col gap-5">
      <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 class="min-w-0 break-words text-lg font-black tracking-tight">Event timeline</h2>
        <span class="badge badge-ghost max-w-full"><span class="truncate">Activity.Recorded + Reports.Published</span></span>
      </div>

      {#if liveEvents.length === 0}
        <div class="alert"><span>Run a report or service workflow to see live inspection activity here.</span></div>
      {:else}
        <div class="divide-y divide-base-300/80 border-y border-base-300/80" aria-live="polite">
          {#each liveEvents as event (event.id)}
            <article class="min-w-0 overflow-hidden bg-base-200/30 px-1 py-4">
              <div class="mb-2 flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <h3 class="break-words font-medium">{event.title}</h3>
                  <p class="break-words text-sm text-base-content/70">{event.detail}</p>
                </div>
                <span class="badge badge-outline max-w-full"><span class="truncate">{event.name}</span></span>
              </div>
              <div class="break-words font-mono text-xs text-base-content/60">{event.occurredAt}</div>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  </section>
  </div>
</section>
