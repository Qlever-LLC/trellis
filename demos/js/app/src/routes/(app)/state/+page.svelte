<script lang="ts">
  import { onMount } from "svelte";
  import { getTrellis } from "$lib/trellis";

  type InspectionContextValue = {
    siteId: string;
    note: string;
    updatedBy: string;
    updatedAt: string;
  };

  type AppStateEntry = {
    key: string;
    value: InspectionContextValue;
    revision: string;
    updatedAt: string;
    expiresAt?: string;
  };

  type AppStatePutResult =
    | { applied: true; entry: AppStateEntry }
    | { applied: false; found: boolean; entry?: AppStateEntry };

  type AppStatePutEntry = Extract<AppStatePutResult, { applied: true }>["entry"];
  type InspectionContextStore = {
    prefix(prefix: string): {
      list(input: { offset: number; limit: number }): {
        orThrow(): Promise<{ entries: AppStateEntry[] }>;
      };
    };
    put(key: string, value: InspectionContextValue): {
      orThrow(): Promise<AppStatePutResult>;
    };
    delete(key: string): {
      orThrow(): Promise<{ deleted: boolean }>;
    };
  };
  type StateDemoTrellis = {
    state: {
      inspectionContext: InspectionContextStore;
    };
  };

  const trellis = getTrellis<StateDemoTrellis>();

  let key = $state("demo.selected-site");
  let siteId = $state("site-west-yard");
  let note = $state("Prioritize the west-yard follow-up during the next browser session.");
  let entries = $state<AppStateEntry[]>([]);
  let latestPut = $state<AppStatePutEntry | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  const inspectionContextStore = trellis.state.inspectionContext;

  async function loadEntries(): Promise<void> {
    loading = true;
    error = null;

    try {
      const response = await inspectionContextStore.prefix("demo.").list({
        offset: 0,
        limit: 12,
      }).orThrow();
      entries = response.entries;
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
      const response = await inspectionContextStore.put(key, {
        siteId,
        note,
        updatedBy: "demo-browser-app",
        updatedAt: new Date().toISOString(),
      }).orThrow();

      if (!response.applied) {
        throw new Error("Inspection context write was not applied.");
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
      await inspectionContextStore.delete(entryKey).orThrow();
      if (latestPut?.key === entryKey) {
        latestPut = null;
      }
      await loadEntries();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function formatValue(value: InspectionContextValue): string {
    return JSON.stringify(value, null, 2);
  }

  onMount(() => {
    void loadEntries();
  });
</script>

<svelte:head>
  <title>State · Trellis demo</title>
</svelte:head>

<section class="flex w-full flex-col gap-6">
  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">State</h1>
    <p class="text-sm text-base-content/70">Write and list entries from a named state store.</p>
  </header>

  {#if error}
    <div role="alert" class="alert alert-error">
      <span>{error}</span>
    </div>
  {/if}

  <div class="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
    <section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <h2 class="card-title text-lg">Write entry</h2>

        <label class="form-control gap-2">
          <span class="label-text font-medium">Store key</span>
          <input class="input input-bordered w-full font-mono" bind:value={key} />
        </label>

        <label class="form-control gap-2">
          <span class="label-text font-medium">Site id</span>
          <input class="input input-bordered w-full font-mono" bind:value={siteId} />
        </label>

        <label class="form-control gap-2">
          <span class="label-text font-medium">Note</span>
          <textarea class="textarea textarea-bordered min-h-40 w-full" bind:value={note}></textarea>
        </label>

        <div class="flex flex-wrap gap-3">
          <button class="btn btn-primary" onclick={saveState} disabled={saving || key.trim().length === 0}>
            {saving ? "Saving..." : "Save state"}
          </button>
          <button class="btn btn-outline" onclick={loadEntries} disabled={loading}>
            Reload entries
          </button>
        </div>

        {#if latestPut}
          <div class="divider my-0">Latest write</div>
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <tbody>
                <tr>
                  <th>Key</th>
                  <td class="font-mono text-xs">{latestPut.key}</td>
                </tr>
                <tr>
                  <th>Revision</th>
                  <td class="font-mono text-xs">{latestPut.revision}</td>
                </tr>
                <tr>
                  <th>Updated</th>
                  <td class="font-mono text-xs">{latestPut.updatedAt}</td>
                </tr>
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>

    <section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="card-title text-lg">inspectionContext</h2>
          <span class="badge badge-outline">{entries.length} entr{entries.length === 1 ? "y" : "ies"}</span>
        </div>

        {#if loading}
          <div class="alert">
            <span>Loading entries.</span>
          </div>
        {:else if entries.length === 0}
          <div class="alert">
            <span>No demo entries yet.</span>
          </div>
        {:else}
          <div class="space-y-4">
            {#each entries as entry (entry.key)}
              <div class="rounded-box border border-base-300 p-4">
                <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div class="space-y-1">
                    <div class="font-mono text-sm font-medium">{entry.key}</div>
                    <div class="font-mono text-xs text-base-content/60">
                      rev {entry.revision} · {entry.updatedAt}
                    </div>
                  </div>
                  <button class="btn btn-outline btn-sm" onclick={() => deleteEntry(entry.key)}>
                    Delete
                  </button>
                </div>

                <pre class="overflow-x-auto whitespace-pre-wrap rounded-box bg-base-200 p-3 text-xs">{formatValue(entry.value)}</pre>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  </div>
</section>
