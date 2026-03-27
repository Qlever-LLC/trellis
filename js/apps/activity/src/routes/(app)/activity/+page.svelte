<script lang="ts">
  import type {
    ActivityGetOutput,
    ActivityListOutput,
  } from "@qlever-llc/trellis-sdk-activity";
  import { getTrellisFor } from "@qlever-llc/trellis-svelte";
  import { onMount } from "svelte";
  import { activityApp } from "../../../contracts/activity_app.ts";
  import {
    errorMessage,
    formatDate,
    labelForKind,
    shortKey,
    toneForKind,
  } from "../../../lib/format";

  const trellisPromise = getTrellisFor(activityApp);
  type ActivityEntry = ActivityListOutput["entries"][number];
  type ActivityKind = ActivityEntry["kind"];

  const kindOptions: Array<{ value: "" | ActivityKind; label: string }> = [
    { value: "", label: "All activity" },
    { value: "auth.connect", label: "Connects" },
    { value: "auth.disconnect", label: "Disconnects" },
    { value: "auth.session_revoked", label: "Session revocations" },
    { value: "auth.connection_kicked", label: "Connection kicks" },
  ];

  let loading = $state(true);
  let detailLoading = $state(false);
  let error = $state<string | null>(null);
  let entries = $state<ActivityEntry[]>([]);
  let selectedId = $state<string | null>(null);
  let selectedEntry = $state<ActivityEntry | null>(null);
  let kind = $state<"" | ActivityKind>("");
  let limit = $state(50);
  let lastUpdatedAt = $state<string | null>(null);

  function countByKind(target: ActivityKind): number {
    return entries.filter((entry) => entry.kind === target).length;
  }

  function securityCount(): number {
    return entries.filter((entry) => entry.kind === "auth.session_revoked" || entry.kind === "auth.connection_kicked").length;
  }

  async function loadDetail(id: string) {
    detailLoading = true;
    selectedId = id;
    error = null;

    try {
      const response: ActivityGetOutput = await (await trellisPromise).requestOrThrow("Activity.Get", { id });
      selectedEntry = response.entry;
    } catch (nextError) {
      error = errorMessage(nextError);
    } finally {
      detailLoading = false;
    }
  }

  async function load() {
    loading = true;
    error = null;

    try {
      const response: ActivityListOutput = await (await trellisPromise).requestOrThrow("Activity.List", {
        limit,
        kind: kind || undefined,
      });

      entries = response.entries;
      lastUpdatedAt = new Date().toISOString();

      if (entries.length === 0) {
        selectedId = null;
        selectedEntry = null;
        return;
      }

      const nextSelectedId = entries.some((entry) => entry.id === selectedId)
        ? selectedId
        : entries[0].id;

      if (nextSelectedId) {
        await loadDetail(nextSelectedId);
      }
    } catch (nextError) {
      error = errorMessage(nextError);
      entries = [];
      selectedId = null;
      selectedEntry = null;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-6">
  <header class="card border border-base-300/70 paper-panel shadow-xl">
    <div class="card-body gap-6 p-6 lg:p-8">
      <div class="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div class="badge badge-outline badge-primary">Projection dashboard</div>
          <h2 class="display mt-3 text-4xl text-base-content">Track auth churn as a readable feed.</h2>
          <p class="mt-3 max-w-3xl text-sm leading-7 text-base-content/70 md:text-base">
            Activity stores normalized auth events in KV, then exposes a compact operator view for connections, revocations, and manual kicks.
          </p>
        </div>

        <div class="rounded-box border border-base-300/60 bg-base-100/55 px-4 py-3 text-sm text-base-content/70 shadow-sm">
          <p class="font-semibold text-base-content">Last refresh</p>
          <p class="mt-1">{formatDate(lastUpdatedAt)}</p>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto] lg:items-end">
        <label class="form-control">
          <div class="label pb-2"><span class="label-text">Filter by kind</span></div>
          <select class="select select-bordered bg-base-100/80" bind:value={kind}>
            {#each kindOptions as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>

        <label class="form-control">
          <div class="label pb-2"><span class="label-text">Visible entries</span></div>
          <select class="select select-bordered bg-base-100/80" bind:value={limit}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </label>

        <button class="btn btn-primary" onclick={load} disabled={loading}>
          {#if loading}
            <span class="loading loading-spinner loading-sm"></span>
            Refreshing
          {:else}
            Refresh feed
          {/if}
        </button>
      </div>
    </div>
  </header>

  {#if error}
    <div class="alert alert-error">
      <span>{error}</span>
    </div>
  {/if}

  <div class="stats stats-vertical gap-4 bg-transparent shadow-none xl:stats-horizontal xl:grid xl:grid-cols-4">
    <div class="stat rounded-box border border-base-300/70 paper-panel shadow-sm">
      <div class="stat-title">Visible activity</div>
      <div class="stat-value text-primary">{entries.length}</div>
      <div class="stat-desc">Current filtered result set</div>
    </div>
    <div class="stat rounded-box border border-base-300/70 paper-panel shadow-sm">
      <div class="stat-title">Connects</div>
      <div class="stat-value text-success">{countByKind("auth.connect")}</div>
      <div class="stat-desc">New authenticated arrivals</div>
    </div>
    <div class="stat rounded-box border border-base-300/70 paper-panel shadow-sm">
      <div class="stat-title">Disconnects</div>
      <div class="stat-value text-info">{countByKind("auth.disconnect")}</div>
      <div class="stat-desc">Normal exits from the feed</div>
    </div>
    <div class="stat rounded-box border border-base-300/70 paper-panel shadow-sm">
      <div class="stat-title">Security actions</div>
      <div class={`stat-value ${securityCount() > 0 ? "text-warning" : "text-base-content"}`}>{securityCount()}</div>
      <div class="stat-desc">Revocations and operator kicks</div>
    </div>
  </div>

  <div class="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
    <section class="card border border-base-300/70 paper-panel shadow-xl">
      <div class="card-body gap-4 p-0">
        <div class="px-6 pt-6">
          <h3 class="display text-2xl text-base-content">Recent entries</h3>
          <p class="text-sm text-base-content/65">Stored `Activity.List` results ordered by most recent activity.</p>
        </div>

        {#if loading}
          <div class="space-y-3 px-6 pb-6">
            {#each Array.from({ length: 5 }) as _}
              <div class="rounded-box border border-base-300/60 bg-base-100/55 p-4">
                <div class="skeleton h-4 w-24"></div>
                <div class="skeleton mt-3 h-6 w-4/5"></div>
                <div class="skeleton mt-3 h-4 w-full"></div>
              </div>
            {/each}
          </div>
        {:else if entries.length === 0}
          <div class="px-6 pb-6">
            <div class="alert">
              <span>No activity entries match the current filter.</span>
            </div>
          </div>
        {:else}
          <div class="space-y-3 px-6 pb-6">
            {#each entries as entry}
              <button
                class={`w-full rounded-box border p-4 text-left transition ${selectedId === entry.id ? "border-primary/60 bg-primary/10" : "border-base-300/60 bg-base-100/55 hover:border-primary/40 hover:bg-base-100/80"}`}
                onclick={() => loadDetail(entry.id)}
              >
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <div class={`badge badge-outline ${toneForKind(entry.kind)}`}>{labelForKind(entry.kind)}</div>
                      <span class="mono text-xs text-base-content/55">{shortKey(entry.id)}</span>
                    </div>
                    <p class="mt-3 text-base font-semibold text-base-content">{entry.summary}</p>
                    <p class="mt-2 text-sm text-base-content/65">{entry.principalLabel}</p>
                  </div>
                  <div class="text-right text-xs text-base-content/55">
                    <p>{formatDate(entry.occurredAt)}</p>
                  </div>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </section>

    <section class="card border border-base-300/70 paper-panel shadow-xl">
      <div class="card-body gap-5 p-6">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="display text-2xl text-base-content">Entry detail</h3>
            <p class="text-sm text-base-content/65">Inspect the normalized projection payload returned by `Activity.Get`.</p>
          </div>
          {#if selectedEntry}
            <div class={`badge badge-outline ${toneForKind(selectedEntry.kind)}`}>{labelForKind(selectedEntry.kind)}</div>
          {/if}
        </div>

        {#if detailLoading}
          <div class="flex items-center gap-3 text-sm text-base-content/65">
            <span class="loading loading-ring loading-sm"></span>
            <span>Loading entry detail...</span>
          </div>
        {:else if !selectedEntry}
          <div class="alert">
            <span>Select an activity row to inspect the stored entry.</span>
          </div>
        {:else}
          <div class="grid gap-4 md:grid-cols-2">
            <div class="rounded-box border border-base-300/60 bg-base-100/55 p-4">
              <p class="text-xs font-semibold uppercase tracking-[0.24em] text-base-content/45">Occurred</p>
              <p class="mt-2 text-sm text-base-content/80">{formatDate(selectedEntry.occurredAt)}</p>
            </div>
            <div class="rounded-box border border-base-300/60 bg-base-100/55 p-4">
              <p class="text-xs font-semibold uppercase tracking-[0.24em] text-base-content/45">Principal</p>
              <p class="mt-2 text-sm text-base-content/80">{selectedEntry.principalLabel}</p>
            </div>
            <div class="rounded-box border border-base-300/60 bg-base-100/55 p-4 md:col-span-2">
              <p class="text-xs font-semibold uppercase tracking-[0.24em] text-base-content/45">Summary</p>
              <p class="mt-2 text-sm leading-7 text-base-content/80">{selectedEntry.summary}</p>
            </div>
            <div class="rounded-box border border-base-300/60 bg-base-100/55 p-4">
              <p class="text-xs font-semibold uppercase tracking-[0.24em] text-base-content/45">Session key</p>
              <p class="mono mt-2 break-all text-sm text-base-content/70">{selectedEntry.sessionKey ?? "-"}</p>
            </div>
            <div class="rounded-box border border-base-300/60 bg-base-100/55 p-4">
              <p class="text-xs font-semibold uppercase tracking-[0.24em] text-base-content/45">User NKey</p>
              <p class="mono mt-2 break-all text-sm text-base-content/70">{selectedEntry.userNkey ?? "-"}</p>
            </div>
            <div class="rounded-box border border-base-300/60 bg-base-100/55 p-4">
              <p class="text-xs font-semibold uppercase tracking-[0.24em] text-base-content/45">Actor</p>
              <p class="mt-2 text-sm text-base-content/80">{selectedEntry.actor ?? "-"}</p>
            </div>
            <div class="rounded-box border border-base-300/60 bg-base-100/55 p-4">
              <p class="text-xs font-semibold uppercase tracking-[0.24em] text-base-content/45">Entry id</p>
              <p class="mono mt-2 break-all text-sm text-base-content/70">{selectedEntry.id}</p>
            </div>
          </div>

          <div class="rounded-box border border-base-300/60 bg-base-100/55 p-4">
            <p class="text-sm font-semibold text-base-content">Raw metadata</p>
            <pre class="mt-3 max-h-80 overflow-auto rounded-box bg-base-200/35 p-4 text-xs leading-6 text-base-content/75">{JSON.stringify(selectedEntry.metadata ?? {}, null, 2)}</pre>
          </div>
        {/if}
      </div>
    </section>
  </div>
</section>
