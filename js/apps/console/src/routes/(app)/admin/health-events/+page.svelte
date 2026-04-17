<script lang="ts">
  import type { HealthHeartbeat } from "@qlever-llc/trellis/health";
  import { ok } from "@qlever-llc/result";
  import { onMount } from "svelte";
  import {
    appendHealthEvent,
    summarizeHealthServices,
    upsertHealthInstance,
    type HealthFeedEvent,
    type HealthInstanceView,
    type HealthServiceStatus,
  } from "../../../../lib/health_events.ts";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { getTrellis } from "../../../../lib/trellis";

  const trellisPromise = getTrellis();
  const STALE_REFRESH_MS = 5_000;

  let recentEvents = $state.raw<HealthFeedEvent[]>([]);
  let instances = $state.raw<Record<string, HealthInstanceView>>({});
  let now = $state(Date.now());
  let subscriptionError = $state<string | null>(null);

  const services = $derived(summarizeHealthServices(instances, now));
  const hasEvents = $derived(recentEvents.length > 0);
  const serviceCount = $derived(services.length);
  const instanceCount = $derived(Object.keys(instances).length);
  const offlineCount = $derived(services.filter((service) => service.status === "offline").length);

  function formatKind(kind: HealthHeartbeat["service"]["kind"]): string {
    return kind === "device" ? "Device" : "Service";
  }

  function statusBadgeClass(status: HealthServiceStatus): string {
    switch (status) {
      case "healthy":
        return "badge-success";
      case "degraded":
        return "badge-warning";
      case "unhealthy":
        return "badge-error";
      case "offline":
        return "badge-ghost";
    }
  }

  function formatSeenAt(value: number): string {
    return formatDate(new Date(value).toISOString());
  }

  function formatRuntime(runtime: string, runtimeVersion?: string): string {
    return runtimeVersion ? `${runtime} ${runtimeVersion}` : runtime;
  }

  function ingestHeartbeat(heartbeat: HealthHeartbeat) {
    const receivedAt = Date.now();
    recentEvents = appendHealthEvent(recentEvents, heartbeat, receivedAt);
    instances = upsertHealthInstance(instances, heartbeat, receivedAt);
    now = receivedAt;
  }

  function handleHeartbeat(heartbeat: HealthHeartbeat) {
    ingestHeartbeat(heartbeat);
    return ok(undefined);
  }

  onMount(() => {
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      now = Date.now();
    }, STALE_REFRESH_MS);

    void (async () => {
      try {
        const trellis = await trellisPromise;
        const result = await trellis.event(
          "Health.Heartbeat",
          {},
          handleHeartbeat,
          { mode: "ephemeral", replay: "new", signal: controller.signal },
        );

        if (result.isErr()) {
          subscriptionError = errorMessage(result.error);
        }
      } catch (error) {
        subscriptionError = errorMessage(error);
      }
    })();

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  });
</script>

<section class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-xl font-semibold">Health Events</h1>
      <p class="text-sm text-base-content/60">Live participant heartbeat stream and current status snapshot for services and devices.</p>
    </div>

    <div class="stats shadow border border-base-300">
      <div class="stat py-2 px-4">
        <div class="stat-title text-xs">Participants</div>
        <div class="stat-value text-xl">{serviceCount}</div>
      </div>
      <div class="stat py-2 px-4">
        <div class="stat-title text-xs">Instances</div>
        <div class="stat-value text-xl">{instanceCount}</div>
      </div>
      <div class="stat py-2 px-4">
        <div class="stat-title text-xs">Offline</div>
        <div class="stat-value text-xl">{offlineCount}</div>
      </div>
    </div>
  </div>

  {#if subscriptionError}
    <div class="alert alert-error">
      <span>{subscriptionError}</span>
    </div>
  {/if}

  {#if !hasEvents}
    <div class="alert alert-info">
      <span>Waiting for live heartbeat events. Participants will appear here as soon as new service or device heartbeats are published.</span>
    </div>
  {:else}
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div class="card border border-base-300 bg-base-100 shadow-sm">
        <div class="card-body gap-4 p-0">
          <div class="flex items-center justify-between px-4 pt-4">
            <h2 class="card-title text-base">Current participants</h2>
            <span class="text-xs text-base-content/50">Updates every {STALE_REFRESH_MS / 1000}s for stale/offline state</span>
          </div>

          <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Participant</th>
                  <th>Status</th>
                  <th>Instances</th>
                  <th>Version / Runtime</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {#each services as service (service.key)}
                  <tr>
                    <td>
                      <div class="flex flex-wrap items-center gap-2">
                        <div class="font-medium">{service.serviceName}</div>
                        <span class="badge badge-ghost badge-xs">{formatKind(service.kind)}</span>
                      </div>
                      <div class="font-mono text-xs text-base-content/50">{service.contractId}</div>
                    </td>
                    <td>
                      <span class={`badge badge-sm ${statusBadgeClass(service.status)}`}>{service.status}</span>
                    </td>
                    <td>
                      <div class="flex flex-wrap gap-1">
                        <span class="badge badge-success badge-outline badge-sm">{service.liveInstances} live</span>
                        <span class="badge badge-warning badge-outline badge-sm">{service.staleInstances} stale</span>
                      </div>
                    </td>
                    <td class="text-sm text-base-content/70">
                      <div>{service.version ?? "—"}</div>
                      <div class="text-xs text-base-content/50">{formatRuntime(service.runtime, service.instances[0]?.runtimeVersion)}</div>
                    </td>
                    <td class="text-sm text-base-content/70">{formatSeenAt(service.lastSeenAt)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <aside class="card border border-base-300 bg-base-100 shadow-sm">
        <div class="card-body gap-3">
          <div class="flex items-center justify-between">
            <h2 class="card-title text-base">Recent heartbeat feed</h2>
            <span class="text-xs text-base-content/50">Newest first</span>
          </div>

          <div class="space-y-3 overflow-y-auto max-xl:max-h-96 xl:max-h-[70vh]">
            {#each recentEvents as event (event.id)}
              <div class="rounded-box border border-base-300 bg-base-200/40 p-3">
                <div class="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <div class="font-medium text-sm">{event.heartbeat.service.name}</div>
                      <span class="badge badge-ghost badge-xs">{formatKind(event.heartbeat.service.kind)}</span>
                    </div>
                    <div class="font-mono text-xs text-base-content/50">{event.heartbeat.service.instanceId}</div>
                  </div>
                  <span class={`badge badge-sm ${statusBadgeClass(event.heartbeat.status === "healthy"
                    ? "healthy"
                    : event.heartbeat.status === "degraded"
                    ? "degraded"
                    : "unhealthy")}`}
                  >
                    {event.heartbeat.status}
                  </span>
                </div>

                <div class="mb-2 text-xs text-base-content/60">
                  <div>published {formatDate(event.heartbeat.header.time)}</div>
                  <div>received {formatSeenAt(event.receivedAt)}</div>
                </div>

                <pre class="overflow-x-auto rounded bg-base-100 p-2 text-[11px] leading-5 text-base-content/80">{JSON.stringify(event.heartbeat, null, 2)}</pre>
              </div>
            {/each}
          </div>
        </div>
      </aside>
    </div>
  {/if}
</section>
