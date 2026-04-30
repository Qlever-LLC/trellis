<script lang="ts">
  import type { HealthHeartbeat } from "@qlever-llc/trellis/health";
  import { ok } from "@qlever-llc/result";
  import { onMount } from "svelte";
  import {
    appendHealthEvent,
    heartbeatInstanceKey,
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
  let selectedParticipantKey = $state<string | null>(null);

  const services = $derived(summarizeHealthServices(instances, now));
  const hasEvents = $derived(recentEvents.length > 0);
  const selectedService = $derived(
    services.find((service) => service.key === selectedParticipantKey) ??
      services[0] ?? null,
  );
  const selectedInstance = $derived(selectedService?.instances[0] ?? null);
  const selectedHeartbeat = $derived.by(() => {
    if (!selectedInstance) return null;
    return recentEvents.find((event) =>
      heartbeatInstanceKey(event.heartbeat) === selectedInstance.key
    )?.heartbeat ?? null;
  });
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
    return `${formatDate(new Date(value).toISOString())} (${formatRelativeTime(value, now)})`;
  }

  function formatRuntime(runtime: string, runtimeVersion?: string): string {
    return runtimeVersion ? `${runtime} ${runtimeVersion}` : runtime;
  }

  function formatRelativeTime(value: number, reference = Date.now()): string {
    const seconds = Math.max(0, Math.floor((reference - value) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function selectParticipant(key: string) {
    selectedParticipantKey = key;
  }

  function formatJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
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

  <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
    <Panel title="Participants" eyebrow="Primary" class="min-w-0">
      {#snippet actions()}
        <span class="inline-flex items-center gap-2 text-xs text-base-content/60">
          <span class="relative flex size-2">
            <span class="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60"></span>
            <span class="relative inline-flex size-2 rounded-full bg-success"></span>
          </span>
          Live updates
        </span>
      {/snippet}
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
                  <tr class={selectedService?.key === service.key ? "bg-base-200/70" : "hover"}>
                    <td>
                      <button
                        type="button"
                        class="group text-left"
                        aria-pressed={selectedService?.key === service.key}
                        onclick={() => selectParticipant(service.key)}
                      >
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="font-medium group-hover:underline">{service.serviceName}</span>
                          <span class="badge badge-outline badge-xs">{formatKind(service.kind)}</span>
                        </div>
                      </button>
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
                    <td class="text-sm text-base-content/70">
                      <div>{formatDate(new Date(service.lastSeenAt).toISOString())}</div>
                      <div class="text-xs text-base-content/50">{formatRelativeTime(service.lastSeenAt, now)}</div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
      {/if}
    </Panel>

    <Panel title="Participant Heartbeat" eyebrow="Secondary" class="min-w-0">
      {#snippet actions()}
        {#if selectedService}
          <span class="text-xs text-base-content/50">{formatRelativeTime(selectedService.lastSeenAt, now)}</span>
        {/if}
      {/snippet}
      {#if !hasEvents}
        <EmptyState title="No heartbeat events yet" description={`Stale/offline state recalculates every ${STALE_REFRESH_MS / 1000}s once events arrive.`} class="py-4" />
      {:else if selectedService && selectedInstance}
        <div class="space-y-4">
          <div class="rounded-box border border-base-300 bg-base-200/40 p-3">
            <div class="mb-3 flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="truncate font-medium text-sm">{selectedService.serviceName}</h2>
                  <span class="badge badge-outline badge-xs">{formatKind(selectedService.kind)}</span>
                </div>
                <div class="trellis-identifier truncate text-base-content/50">{selectedInstance.instanceId}</div>
              </div>
              <StatusBadge label={selectedService.status} status={selectedService.status} />
            </div>

            <dl class="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt class="text-base-content/60">Last seen</dt>
              <dd>{formatSeenAt(selectedService.lastSeenAt)}</dd>
              <dt class="text-base-content/60">Runtime</dt>
              <dd>{formatRuntime(selectedInstance.runtime, selectedInstance.runtimeVersion)}</dd>
              <dt class="text-base-content/60">Version</dt>
              <dd>{selectedInstance.version ?? "—"}</dd>
              <dt class="text-base-content/60">Interval</dt>
              <dd>{selectedInstance.publishIntervalMs / 1000}s</dd>
            </dl>
          </div>

          <div>
            <div class="mb-2 flex items-center justify-between gap-2">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Heartbeat checks</h3>
              <span class="badge badge-ghost badge-sm">{selectedInstance.checks.length}</span>
            </div>

            {#if selectedInstance.checks.length === 0}
              <EmptyState title="No custom checks" description="This heartbeat only contains baseline participant metadata." class="py-3" />
            {:else}
              <div class="overflow-x-auto rounded-box border border-base-300">
                <table class="table table-xs">
                  <thead>
                    <tr>
                      <th>Check</th>
                      <th>Status</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each selectedInstance.checks as check (check.name)}
                      <tr>
                        <td class="font-medium">{check.name}</td>
                        <td><StatusBadge label={check.status} status={check.status === "ok" ? "healthy" : "unhealthy"} /></td>
                        <td class="max-w-48 text-base-content/70">
                          {#if check.summary}
                            <div>{check.summary}</div>
                          {/if}
                          {#if check.info}
                            <pre class="mt-1 overflow-x-auto rounded bg-base-100 p-2 text-[11px] leading-5">{formatJson(check.info)}</pre>
                          {:else if !check.summary}
                            <span class="text-base-content/40">—</span>
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </div>

          {#if selectedHeartbeat}
            <details class="collapse collapse-arrow rounded-box border border-base-300 bg-base-200/30">
              <summary class="collapse-title min-h-0 py-3 text-sm font-medium">Latest heartbeat payload</summary>
              <div class="collapse-content">
                <pre class="overflow-x-auto rounded bg-base-100 p-2 text-[11px] leading-5 text-base-content/80">{formatJson(selectedHeartbeat)}</pre>
              </div>
            </details>
          {/if}
        </div>
      {:else}
        <EmptyState title="Select a participant" description="Choose a participant from the table to inspect its latest heartbeat values." class="py-4" />
      {/if}
    </Panel>
  </div>
</section>
