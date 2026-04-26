<script lang="ts">
  import { onMount } from "svelte";
  import { ok } from "@qlever-llc/result";
  import { getTrellis } from "$lib/trellis-context.ts";

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
  let error = $state<string | null>(null);
  let liveEvents = $state<LiveEvent[]>([]);
  let controller: AbortController | null = null;

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
    liveEvents = [event, ...liveEvents].slice(0, 20);
  }

  async function startListening(): Promise<void> {
    if (listening) return;

    error = null;
    controller = new AbortController();

    try {
      await trellis.event(
        "Activity.Recorded",
        {},
        (event: unknown) => {
          if (isActivityRecordedEvent(event)) {
            addEvent({
              id: event.activityId,
              name: "Activity.Recorded",
              title: event.kind,
              detail: event.message,
              occurredAt: event.occurredAt,
            });
          }
          return ok(undefined);
        },
        { mode: "ephemeral", replay: "new", signal: controller.signal },
      ).orThrow();

      await trellis.event(
        "Reports.Published",
        {},
        (event: unknown) => {
          if (isReportsPublishedEvent(event)) {
            addEvent({
              id: event.reportId,
              name: "Reports.Published",
              title: "Report published",
              detail: `${event.reportId} for ${event.inspectionId}`,
              occurredAt: event.publishedAt,
            });
          }
          return ok(undefined);
        },
        { mode: "ephemeral", replay: "new", signal: controller.signal },
      ).orThrow();

      listening = true;
    } catch (cause) {
      controller.abort();
      controller = null;
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function stopListening(): void {
    controller?.abort();
    controller = null;
    listening = false;
  }

  onMount(() => {
    void startListening();
    return stopListening;
  });
</script>

<svelte:head>
  <title>Live Feed · Field Inspection Desk</title>
</svelte:head>

<section class="flex w-full flex-col gap-6">
  <header class="rounded-box border border-base-300 bg-base-100/80 p-4 shadow-sm md:p-5">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div class="space-y-2">
        <div class="badge badge-primary badge-outline">Activity → Live Feed</div>
        <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">Live Feed</h1>
        <p class="max-w-3xl text-sm text-base-content/70">
          Keep a live watch on field activity and report publication events as inspection work moves through the desk.
        </p>
      </div>
      <div class="flex flex-wrap gap-3">
        <button class="btn btn-primary btn-sm" onclick={startListening} disabled={listening}>Start feed</button>
        <button class="btn btn-outline btn-sm" onclick={stopListening} disabled={!listening}>Pause feed</button>
        <span class={listening ? "badge badge-success badge-outline badge-lg" : "badge badge-warning badge-outline badge-lg"}>
          {listening ? "live" : "paused"}
        </span>
        <span class="badge badge-outline badge-lg">Teaching note: events</span>
      </div>
    </div>
  </header>

  {#if error}
    <div role="alert" class="alert alert-error"><span>{error}</span></div>
  {/if}

  <section class="card border border-base-300 bg-base-100 shadow-sm">
    <div class="card-body gap-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="card-title text-lg">Event timeline</h2>
        <span class="badge badge-ghost">Activity.Recorded + Reports.Published</span>
      </div>

      {#if liveEvents.length === 0}
        <div class="alert"><span>Run a report or service workflow to see live inspection activity here.</span></div>
      {:else}
        <div class="space-y-3">
          {#each liveEvents as event (event.id)}
            <article class="rounded-box border border-base-300 bg-base-200/40 p-4">
              <div class="mb-2 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 class="font-medium">{event.title}</h3>
                  <p class="text-sm text-base-content/70">{event.detail}</p>
                </div>
                <span class="badge badge-outline">{event.name}</span>
              </div>
              <div class="font-mono text-xs text-base-content/60">{event.occurredAt}</div>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  </section>
</section>
