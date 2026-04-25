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
  <title>Activity · Field Ops Console</title>
</svelte:head>

<section class="flex w-full flex-col gap-6">
  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Activity</h1>
    <p class="text-sm text-base-content/70">Subscribe to live field activity and report publication events.</p>
    <div class="badge badge-outline">Uses: events</div>
  </header>

  <div class="flex flex-wrap gap-3">
    <button class="btn btn-primary btn-sm" onclick={startListening} disabled={listening}>Start listening</button>
    <button class="btn btn-outline btn-sm" onclick={stopListening} disabled={!listening}>Stop</button>
    <span class={listening ? "badge badge-success badge-outline badge-lg" : "badge badge-warning badge-outline badge-lg"}>
      {listening ? "listening" : "stopped"}
    </span>
  </div>

  {#if error}
    <div role="alert" class="alert alert-error"><span>{error}</span></div>
  {/if}

  <section class="card border border-base-300 bg-base-100 shadow-sm">
    <div class="card-body gap-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="card-title text-lg">Live events</h2>
        <span class="text-sm text-base-content/60">Activity.Recorded + Reports.Published</span>
      </div>

      {#if liveEvents.length === 0}
        <div class="alert"><span>Run a report or service workflow to see live activity here.</span></div>
      {:else}
        <div class="space-y-3">
          {#each liveEvents as event (event.id)}
            <article class="rounded-box border border-base-300 p-4">
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
