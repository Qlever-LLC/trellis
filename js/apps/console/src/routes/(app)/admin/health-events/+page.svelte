<script lang="ts">
  import type { HealthHeartbeat } from "@qlever-llc/trellis/health";
  import { ok } from "@qlever-llc/result";
  import { onMount } from "svelte";
  import {
    appendHealthEvent,
    pruneExpiredHealthInstances,
    summarizeHealthServices,
    upsertHealthInstance,
    type HealthFeedEvent,
    type HealthInstanceView,
  } from "../../../../lib/health_events.ts";
  import EmptyState from "../../../../lib/components/EmptyState.svelte";
  import InlineMetricsStrip from "../../../../lib/components/InlineMetricsStrip.svelte";
  import PageToolbar from "../../../../lib/components/PageToolbar.svelte";
  import Panel from "../../../../lib/components/Panel.svelte";
  import StatusBadge from "../../../../lib/components/StatusBadge.svelte";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { getTrellis } from "../../../../lib/trellis";

  const trellis = getTrellis();
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
  const metrics = $derived([
    { label: "Participants", value: serviceCount, detail: "Service and device groups" },
    { label: "Instances", value: instanceCount, detail: "Live heartbeat identities" },
    { label: "Offline", value: offlineCount, detail: "Stale beyond heartbeat TTL" },
    { label: "Events", value: recentEvents.length, detail: "Buffered heartbeat feed" },
  ]);

  function formatKind(kind: HealthHeartbeat["service"]["kind"]): string {
    return kind === "device" ? "Device" : "Service";
  }

  function formatSeenAt(value: number): string {
    return formatDate(new Date(value).toISOString());
  }

  function formatRuntime(runtime: string, runtimeVersion?: string): string {
    return runtimeVersion ? `${runtime} ${runtimeVersion}` : runtime;
  }

  function ingestHeartbeat(heartbeat: HealthHeartbeat) {
    const receivedAt = Date.now();
    const activeInstances = pruneExpiredHealthInstances(instances, receivedAt);
    recentEvents = appendHealthEvent(recentEvents, heartbeat, receivedAt);
    instances = upsertHealthInstance(activeInstances, heartbeat, receivedAt);
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
      instances = pruneExpiredHealthInstances(instances, currentTime);
      now = currentTime;
    }, STALE_REFRESH_MS);

    void (async () => {
      try {
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
  <PageToolbar
    title="Health Events"
    description="Live participant heartbeat stream and current status snapshot for services and devices."
  />

  <InlineMetricsStrip {metrics} />

  {#if subscriptionError}
    <div class="alert alert-error">
      <span>{subscriptionError}</span>
    </div>
  {/if}

  <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
    <Panel title="Participants" eyebrow="Primary" class="min-w-0">
      {#if !hasEvents}
        <EmptyState title="Waiting for heartbeat events" description="Participants will appear here as soon as new service or device heartbeats are published." />
      {:else}
          <div class="overflow-x-auto">
            <table class="table table-sm trellis-table">
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
                        <span class="badge badge-outline badge-xs">{formatKind(service.kind)}</span>
                      </div>
                      <div class="trellis-identifier text-base-content/50">{service.contractId}</div>
                    </td>
                    <td>
                      <StatusBadge label={service.status} status={service.status} />
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
      {/if}
    </Panel>

    <Panel title="Heartbeat Stream" eyebrow="Secondary" class="min-w-0">
      {#snippet actions()}
        <span class="text-xs text-base-content/50">Newest first</span>
      {/snippet}
      {#if !hasEvents}
        <EmptyState title="No heartbeat events yet" description={`Stale/offline state recalculates every ${STALE_REFRESH_MS / 1000}s once events arrive.`} class="py-4" />
      {:else}
          <div class="space-y-3 overflow-y-auto max-xl:max-h-96 xl:max-h-[70vh]">
            {#each recentEvents as event (event.id)}
              <div class="rounded-box border border-base-300 bg-base-200/40 p-3">
                <div class="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <div class="font-medium text-sm">{event.heartbeat.service.name}</div>
                      <span class="badge badge-outline badge-xs">{formatKind(event.heartbeat.service.kind)}</span>
                    </div>
                    <div class="trellis-identifier text-base-content/50">{event.heartbeat.service.instanceId}</div>
                  </div>
                  <StatusBadge label={event.heartbeat.status} status={event.heartbeat.status} />
                </div>

                <div class="mb-2 text-xs text-base-content/60">
                  <div>published {formatDate(event.heartbeat.header.time)}</div>
                  <div>received {formatSeenAt(event.receivedAt)}</div>
                </div>

                <pre class="overflow-x-auto rounded bg-base-100 p-2 text-[11px] leading-5 text-base-content/80">{JSON.stringify(event.heartbeat, null, 2)}</pre>
              </div>
            {/each}
          </div>
      {/if}
    </Panel>
  </div>
</section>
