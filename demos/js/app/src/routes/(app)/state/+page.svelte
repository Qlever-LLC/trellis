<script lang="ts">
  import { onMount } from "svelte";
  import type {
    StateListOutput,
    StatePutInput,
    StatePutOutput,
  } from "@qlever-llc/trellis-sdk/state";
  import { requestValue, type AppStateEntry } from "$lib/trellis";

  let key = $state("demo.selected-site");
  let siteId = $state("site-west-yard");
  let note = $state("Prioritize the west-yard follow-up during the next browser session.");
  let entries = $state<AppStateEntry[]>([]);
  let latestPut = $state<StatePutOutput["entry"] | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function loadEntries(): Promise<void> {
    loading = true;
    error = null;

    try {
      const response = await requestValue("State.List", {
        scope: "userApp",
        prefix: "demo.",
        offset: 0,
        limit: 12,
      });
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
      const payload: StatePutInput = {
        scope: "userApp",
        key,
        value: {
          siteId,
          note,
          updatedBy: "demo-browser-app",
          updatedAt: new Date().toISOString(),
        },
      };
      const response = await requestValue("State.Put", payload);
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
      await requestValue("State.Delete", {
        scope: "userApp",
        key: entryKey,
      });
      if (latestPut?.key === entryKey) {
        latestPut = null;
      }
      await loadEntries();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  onMount(() => {
    void loadEntries();
  });
</script>

<svelte:head>
  <title>State · Field inspection demo</title>
</svelte:head>

<section class="stack">
  <header class="page-header">
    <p class="eyebrow">State surface</p>
    <h1>Persist small app memory</h1>
    <p class="page-summary">This route writes to the Trellis-managed app state namespace so the browser can keep compact user-app context between sessions.</p>
  </header>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  <div class="feature-grid" style="grid-template-columns: 0.95fr 1.05fr;">
    <section class="surface-card stack">
      <h2 class="section-title">Write a demo state entry</h2>
      <div class="form-grid">
        <label>
          <span class="muted">State key</span>
          <input class="input code" bind:value={key} />
        </label>

        <label>
          <span class="muted">Selected site</span>
          <input class="input code" bind:value={siteId} />
        </label>

        <label>
          <span class="muted">Operator note</span>
          <textarea class="textarea" bind:value={note}></textarea>
        </label>

        <div class="button-row">
          <button class="button" onclick={saveState} disabled={saving || key.trim().length === 0}>
            {saving ? "Saving…" : "Save user-app state"}
          </button>
          <button class="ghost-button" onclick={loadEntries} disabled={loading}>Reload list</button>
        </div>
      </div>

      {#if latestPut}
        <div class="panel">
          <span class="kicker">Latest write</span>
          <dl class="field-list">
            <li><strong class="code">{latestPut.key}</strong><span class="muted">Stored key</span></li>
            <li><strong class="code">{latestPut.revision}</strong><span class="muted">Revision</span></li>
            <li><strong class="code">{latestPut.updatedAt}</strong><span class="muted">Updated at</span></li>
          </dl>
        </div>
      {/if}
    </section>

    <section class="surface-card stack">
      <div class="split">
        <h2 class="section-title">Current demo namespace</h2>
        <span class="pill">{entries.length} keys</span>
      </div>

      {#if loading}
        <div class="empty-state">Listing user-app state…</div>
      {:else if entries.length === 0}
        <div class="empty-state">No demo keys exist yet. Save one from the form to the left.</div>
      {:else}
        <ul class="data-list">
          {#each entries as entry (entry.key)}
            <li>
              <div class="split">
                <strong class="code">{entry.key}</strong>
                <button class="ghost-button" onclick={() => deleteEntry(entry.key)}>Delete</button>
              </div>
              <p class="status-line code">rev {entry.revision} · {entry.updatedAt}</p>
              <pre class="code muted">{JSON.stringify(entry.value, null, 2)}</pre>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</section>
