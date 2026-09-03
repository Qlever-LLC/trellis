<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    HealthInspectOutput,
    HealthMetricsOutput,
    HealthQueryOutput,
  } from "@trellis/apis/trellis.health";
  import { onMount } from "svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import InlineMetricsStrip from "$lib/components/InlineMetricsStrip.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import Term from "$lib/components/Term.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type Participant = HealthQueryOutput["entries"][number];

  const trellis = getTrellis();
  const RPC_TIMEOUT_MS = 10_000;

  let snapshot = $state.raw<HealthQueryOutput | null>(null);
  let inspection = $state.raw<HealthInspectOutput | null>(null);
  let healthMetrics = $state.raw<HealthMetricsOutput | null>(null);
  let loading = $state(true);
  let detailLoading = $state(false);
  let error = $state<string | null>(null);
  let watchError = $state<string | null>(null);
  let selectedKey = $state<string | null>(null);

  const participants = $derived(snapshot?.entries ?? []);
  const selectedParticipant = $derived(
    participants.find((participant) => participantKey(participant) === selectedKey) ??
      participants[0] ?? null,
  );
  const instances = $derived(inspection?.instances ?? []);
  const selectedInstance = $derived(instances[0] ?? null);
  const offlineCount = $derived(
    participants.filter((participant) => participant.effectiveStatus === "offline").length,
  );
  const instanceCount = $derived(
    participants.reduce(
      (count, participant) =>
        count + participant.onlineInstances + participant.offlineInstances,
      0,
    ),
  );
  const metrics = $derived([
    { label: "Participants", value: snapshot?.count ?? 0, detail: "Service and device groups" },
    { label: "Instances", value: instanceCount, detail: "Retained runtime identities" },
    { label: "Offline", value: offlineCount, detail: "Past heartbeat deadline" },
    { label: "Revision", value: snapshot?.projection.revision ?? 0, detail: "Committed projection state" },
  ]);

  function participantKey(participant: Participant): string {
    return `${participant.participantKind}:${participant.contractId}`;
  }

  function formatKind(kind: string): string {
    return kind === "device" ? "Device" : "Service";
  }

  function formatRelativeTime(value: string, reference = Date.now()): string {
    const seconds = Math.max(0, Math.floor((reference - Date.parse(value)) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function formatAvailability(value: number | null | undefined): string {
    return value == null ? "No observations" : `${(value * 100).toFixed(2)}%`;
  }

  function formatJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  async function loadParticipants(): Promise<void> {
    const result = await trellis.healthQuery({ limit: 200, offset: 0 },
      { timeout: RPC_TIMEOUT_MS },
    ).take();
    if (isErr(result)) throw result;
    snapshot = result;
    if (!selectedKey && result.entries[0]) {
      selectedKey = participantKey(result.entries[0]);
    }
  }

  async function loadDetail(participant: Participant | null): Promise<void> {
    if (!participant) {
      inspection = null;
      healthMetrics = null;
      return;
    }
    detailLoading = true;
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    try {
      const [inspectResult, metricsResult] = await Promise.all([
        trellis.healthInspect({
            participantKind: participant.participantKind,
            contractId: participant.contractId,
            historyLimit: 100,
          },
          { timeout: RPC_TIMEOUT_MS },
        ).take(),
        trellis.healthMetrics({
            participantKind: participant.participantKind,
            contractId: participant.contractId,
            start: start.toISOString(),
            end: end.toISOString(),
            stepMs: 60 * 60 * 1000,
          },
          { timeout: RPC_TIMEOUT_MS },
        ).take(),
      ]);
      if (isErr(inspectResult)) throw inspectResult;
      if (isErr(metricsResult)) throw metricsResult;
      inspection = inspectResult;
      healthMetrics = metricsResult;
    } finally {
      detailLoading = false;
    }
  }

  async function refresh(): Promise<void> {
    await loadParticipants();
    await loadDetail(selectedParticipant);
  }

  async function selectParticipant(participant: Participant): Promise<void> {
    selectedKey = participantKey(participant);
    error = null;
    try {
      await loadDetail(participant);
    } catch (cause) {
      error = errorMessage(cause);
    }
  }

  onMount(() => {
    const controller = new AbortController();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        await refresh();
      } catch (cause) {
        error = errorMessage(cause);
      } finally {
        loading = false;
      }

      try {
        const result = await trellis.healthWatch(
          {},
          { signal: controller.signal },
        ).take();
        if (isErr(result)) {
          watchError = errorMessage(result);
          return;
        }
        for await (const event of result) {
          if (event.type === "ready") continue;
          if (refreshTimer !== undefined) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => {
            void refresh().catch((cause) => {
              watchError = errorMessage(cause);
            });
          }, 250);
        }
      } catch (cause) {
        if (!controller.signal.aborted) watchError = errorMessage(cause);
      }
    })();

    return () => {
      controller.abort();
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    };
  });
</script>

<section class="space-y-4">
  <PageToolbar
    title="Participant Health"
    description="Current service and device health from the retained runtime projection."
  />

  <InlineMetricsStrip {metrics} />

  {#if error}<Notice variant="error">{error}</Notice>{/if}
  {#if watchError}<Notice variant="warning">Live refresh unavailable: {watchError}</Notice>{/if}
  {#if snapshot?.projection.gapDetected}
    <Notice variant="warning">Projection history contains a transport retention gap. Current participant state may be incomplete.</Notice>
  {/if}

  {#if loading}
    <LoadingState label="Loading participant health" />
  {:else}
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_30rem]">
      <Panel title="Participants" eyebrow="Primary" class="min-w-0">
        {#snippet actions()}
          <span class="text-xs text-base-content/50">
            As of {snapshot ? formatDate(snapshot.asOf) : "-"}
          </span>
        {/snippet}
        {#if participants.length === 0}
          <EmptyState title="No health participants" description="Participants appear after their first runtime heartbeat sample is projected." />
        {:else}
          <DataTable>
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
              {#each participants as participant (participantKey(participant))}
                <tr class={participantKey(participant) === participantKey(selectedParticipant ?? participant) ? "bg-base-200/70" : "hover"}>
                  <td>
                    <button
                      type="button"
                      class="group text-left"
                      aria-pressed={selectedParticipant === participant}
                      onclick={() => void selectParticipant(participant)}
                    >
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="font-medium group-hover:underline">{participant.participantName}</span>
                        <span class="badge badge-outline badge-xs">{formatKind(participant.participantKind)}</span>
                      </div>
                    </button>
                    <div class="trellis-identifier text-base-content/50">{participant.contractId}</div>
                  </td>
                  <td><StatusBadge label={participant.effectiveStatus} status={participant.effectiveStatus} /></td>
                  <td>
                    <div class="flex flex-wrap gap-1">
                      <span class="badge badge-success badge-outline badge-sm">{participant.onlineInstances} online</span>
                      <span class="badge badge-neutral badge-outline badge-sm">{participant.offlineInstances} offline</span>
                    </div>
                  </td>
                  <td class="text-sm text-base-content/70">
                    <div>{participant.versions.join(", ") || "-"}</div>
                    <div class="text-xs text-base-content/50">{participant.runtimes.join(", ") || "-"}</div>
                  </td>
                  <td class="text-sm text-base-content/70">
                    <div>{formatDate(participant.lastSeenAt)}</div>
                    <div class="text-xs text-base-content/50">{formatRelativeTime(participant.lastSeenAt)}</div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </DataTable>
        {/if}
      </Panel>

      <Panel title="Participant Detail" eyebrow="Secondary" class="min-w-0">
        {#if detailLoading}
          <LoadingState label="Loading participant detail" />
        {:else if inspection && selectedParticipant}
          <div class="space-y-4">
            <div class="rounded-box border border-base-300 bg-base-200/40 p-3">
              <div class="mb-3 flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <h2 class="truncate text-sm font-medium">{inspection.participant.participantName}</h2>
                  <div class="trellis-identifier truncate text-base-content/50">{inspection.participant.contractId}</div>
                </div>
                <StatusBadge label={inspection.participant.effectiveStatus} status={inspection.participant.effectiveStatus} />
              </div>
              <dl class="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                <dt class="text-base-content/60">24h availability</dt>
                <dd>{formatAvailability(healthMetrics?.summary.availability)}</dd>
                <dt class="text-base-content/60">Samples</dt>
                <dd>{healthMetrics?.summary.sampleCount ?? 0}</dd>
                <dt class="text-base-content/60">Transitions</dt>
                <dd>{healthMetrics?.summary.transitions ?? 0}</dd>
                <dt class="text-base-content/60">Instances</dt>
                <dd>{inspection.participant.onlineInstances} online / {inspection.participant.offlineInstances} offline</dd>
              </dl>
            </div>

            {#if selectedInstance}
              <div>
                <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">Latest instance</h3>
                <dl class="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                  <dt class="text-base-content/60">Instance</dt>
                  <dd class="trellis-identifier truncate">{selectedInstance.instanceId}</dd>
                  <dt class="text-base-content/60">Deployment</dt>
                  <dd class="trellis-identifier truncate">{selectedInstance.deploymentId}</dd>
                  <dt class="text-base-content/60">Observed</dt>
                  <dd>{formatDate(selectedInstance.observedAt)} ({formatRelativeTime(selectedInstance.observedAt)})</dd>
                  <dt class="text-base-content/60">Deadline</dt>
                  <dd>{formatDate(selectedInstance.heartbeatDeadline)}</dd>
                </dl>
              </div>

              <div>
                <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">Heartbeat checks</h3>
                {#if selectedInstance.latestSample.checks.length === 0}
                  <EmptyState title="No custom checks" description="The latest sample only contains participant metadata." class="py-3" />
                {:else}
                  <div class="overflow-x-auto rounded-box border border-base-300">
                    <table class="table table-xs">
                      <thead><tr><th>Check</th><th>Status</th><th>Latency</th><th>Summary</th></tr></thead>
                      <tbody>
                        {#each selectedInstance.latestSample.checks as check (check.name)}
                          <tr>
                            <td class="font-medium">{check.name}</td>
                            <td><StatusBadge label={check.status} status={check.status === "ok" ? "healthy" : "unhealthy"} /></td>
                            <td>{check.latencyMs.toFixed(1)} ms</td>
                            <td class="max-w-48 text-base-content/70">{check.summary ?? "-"}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                {/if}
              </div>

              <div>
                <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">Status history</h3>
                <div class="overflow-x-auto rounded-box border border-base-300">
                  <table class="table table-xs">
                    <thead><tr><th>Status</th><th>Started</th><th>Ended</th><th>Reason</th></tr></thead>
                    <tbody>
                      {#each inspection.history as interval (interval.intervalId)}
                        <tr>
                          <td><StatusBadge label={interval.effectiveStatus} status={interval.effectiveStatus} /></td>
                          <td>{formatDate(interval.startedAt)}</td>
                          <td>{interval.endedAt ? formatDate(interval.endedAt) : "Current"}</td>
                          <td class="text-base-content/70">{interval.reason}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">Latest <Term term="heartbeat" /> payload</h3>
                <pre class="max-h-80 overflow-auto rounded-box border border-base-300 bg-base-100 p-3 text-[11px] leading-5 text-base-content/80">{formatJson(selectedInstance.latestSample)}</pre>
              </div>
            {/if}
          </div>
        {:else}
          <EmptyState title="Select a participant" description="Choose a participant to inspect current instances and retained status history." class="py-4" />
        {/if}
      </Panel>
    </div>
  {/if}
</section>
