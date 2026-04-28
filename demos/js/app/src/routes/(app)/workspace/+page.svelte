<script lang="ts">
  import { onMount } from "svelte";
  import { getTrellis } from "$lib/trellis";

  type WorkspaceContextValue = {
    siteId: string;
    note: string;
    updatedBy: string;
    updatedAt: string;
  };

  const trellis = getTrellis();
  const workspaceContextStore = trellis.state.workspaceContext;

  type AppStateListResult = Awaited<ReturnType<ReturnType<typeof workspaceContextStore.list>["orThrow"]>>;
  type AppStateEntry = AppStateListResult["entries"][number];
  type ReadableAppStateEntry = Exclude<AppStateEntry, { migrationRequired: true }>;
  type AppStatePutResult = Awaited<ReturnType<ReturnType<typeof workspaceContextStore.put>["orThrow"]>>;
  type AppStatePutEntry = Extract<AppStatePutResult, { applied: true }>["entry"];

  let key = $state("demo.selected-site");
  let siteId = $state("site-west-yard");
  let note = $state("Prioritize the west-yard follow-up during the next browser session.");
  let entries = $state<ReadableAppStateEntry[]>([]);
  let latestPut = $state<AppStatePutEntry | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function loadEntries(): Promise<void> {
    loading = true;
    error = null;

    try {
      const response = await workspaceContextStore.prefix("demo.").list({ offset: 0, limit: 12 }).orThrow();
      entries = response.entries.filter((entry): entry is ReadableAppStateEntry => !("migrationRequired" in entry));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function saveState(): Promise<void> {
    saving = true;
    error = null;

    try {
      const response = await workspaceContextStore.put(key, {
        siteId,
        note,
        updatedBy: "field-ops-console",
        updatedAt: new Date().toISOString(),
      }).orThrow();

      if (!response.applied) {
        throw new Error("Workspace context write was not applied.");
      }

      latestPut = response.entry;
      await loadEntries();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving = false;
    }
  }

  async function deleteEntry(entryKey: string): Promise<void> {
    error = null;

    try {
      await workspaceContextStore.delete(entryKey).orThrow();
      if (latestPut?.key === entryKey) {
        latestPut = null;
      }
      await loadEntries();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function formatValue(value: WorkspaceContextValue): string {
    return JSON.stringify(value, null, 2);
  }

  onMount(() => {
    void loadEntries();
  });
</script>

<svelte:head>
  <title>Workspace State · Field Inspection Desk</title>
</svelte:head>

<section class="page-sheet rounded-box p-5 sm:p-7">
  <div class="flex flex-col gap-6">
  <header class="pb-1">
    <div class="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div class="min-w-0 space-y-3">
        <div class="trellis-kicker">Workspace state</div>
        <h1 class="text-2xl font-black tracking-tight md:text-3xl">Operator notes</h1>
        <p class="max-w-3xl text-sm text-base-content/70">
          Save desk context for the active site, review recent notes, and clear stale handoff entries from the shared workspace state.
        </p>
      </div>
      <div class="badge badge-outline badge-lg">Teaching note: state store</div>
    </div>
  </header>

  {#if error}
    <div role="alert" class="alert alert-error"><span>{error}</span></div>
  {/if}

  <div class="section-rule grid gap-7 pt-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
    <section class="min-w-0">
      <div class="flex flex-col gap-5">
        <h2 class="text-lg font-black tracking-tight">Handoff note</h2>
        <p class="text-sm text-base-content/70">
          Capture the site the operator is focused on and the next action for the following browser session.
        </p>

        <label class="form-control gap-2">
          <span class="label-text font-medium">Workspace key</span>
          <input class="input input-bordered w-full font-mono" bind:value={key} />
        </label>

        <label class="form-control gap-2">
          <span class="label-text font-medium">Active site id</span>
          <input class="input input-bordered w-full font-mono" bind:value={siteId} />
        </label>

        <label class="form-control gap-2">
          <span class="label-text font-medium">Operator note</span>
          <textarea class="textarea textarea-bordered min-h-40 w-full" bind:value={note}></textarea>
        </label>

        <div class="flex flex-wrap gap-3">
          <button class="btn btn-accent" onclick={saveState} disabled={saving || key.trim().length === 0}>
            {saving ? "Saving note..." : "Save operator note"}
          </button>
          <button class="btn btn-outline" onclick={loadEntries} disabled={loading}>Refresh notes</button>
        </div>

        {#if latestPut}
          <div class="divider my-0">Latest saved note</div>
          <div class="overflow-x-auto">
            <table class="table table-sm executive-table">
              <tbody>
                <tr><th>Key</th><td class="font-mono text-xs">{latestPut.key}</td></tr>
                <tr><th>Revision</th><td class="font-mono text-xs">{latestPut.revision}</td></tr>
                <tr><th>Updated</th><td class="font-mono text-xs">{latestPut.updatedAt}</td></tr>
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>

    <section class="min-w-0 border-t border-base-300/80 pt-6 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
      <div class="flex flex-col gap-5">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-lg font-black tracking-tight">Notes ledger</h2>
          <span class="badge badge-outline">{entries.length} entr{entries.length === 1 ? "y" : "ies"}</span>
        </div>

        {#if loading}
          <div class="alert"><span>Loading operator notes.</span></div>
        {:else if entries.length === 0}
          <div class="alert"><span>No operator notes are stored yet.</span></div>
        {:else}
          <div class="divide-y divide-base-300/80 border-y border-base-300/80">
            {#each entries as entry (entry.key)}
              <div class="py-4">
                <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div class="space-y-1">
                    <div class="font-mono text-sm font-medium">{entry.key}</div>
                    <div class="font-mono text-xs text-base-content/60">rev {entry.revision} · {entry.updatedAt}</div>
                  </div>
                  <button class="btn btn-outline btn-sm" onclick={() => deleteEntry(entry.key)}>Delete</button>
                </div>

                <pre class="overflow-x-auto whitespace-pre-wrap rounded-box bg-base-200 p-3 text-xs">{formatValue(entry.value)}</pre>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  </div>
  </div>
</section>
