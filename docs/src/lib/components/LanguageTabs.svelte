<script lang="ts">
  import type { Snippet } from "svelte";

  type Language = "ts" | "rust";

  type Props = {
    ts?: Snippet;
    rust?: Snippet;
    tsLabel?: string;
    rustLabel?: string;
    initial?: Language;
  };

  type Tab = {
    id: Language;
    label: string;
    snippet: Snippet;
  };

  let { ts, rust, tsLabel = "TS", rustLabel = "Rust", initial = "ts" }: Props = $props();

  const baseId = $props.id();
  let active: Language | undefined = $state();

  let tabs: Tab[] = $derived.by(() => {
    const available: Tab[] = [];

    if (ts) {
      available.push({ id: "ts", label: tsLabel, snippet: ts });
    }

    if (rust) {
      available.push({ id: "rust", label: rustLabel, snippet: rust });
    }

    return available;
  });

  let selected = $derived(tabs.find((tab) => tab.id === (active ?? initial)) ?? tabs[0]);
</script>

{#if selected}
  <div class="not-prose my-6 rounded-box border border-base-300 bg-base-100">
    <div role="tablist" aria-label="Code language" class="tabs tabs-boxed rounded-b-none bg-base-200 p-1">
      {#each tabs as tab (tab.id)}
        <button
          id={`${baseId}-${tab.id}-tab`}
          type="button"
          role="tab"
          aria-selected={selected.id === tab.id}
          aria-controls={`${baseId}-${tab.id}-panel`}
          class={["tab", selected.id === tab.id && "tab-active"]}
          onclick={() => (active = tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </div>

    {#each tabs as tab (tab.id)}
      <div
        id={`${baseId}-${tab.id}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-${tab.id}-tab`}
        hidden={selected.id !== tab.id}
        class="p-4"
      >
        {#if selected.id === tab.id}
          {@render tab.snippet()}
        {/if}
      </div>
    {/each}
  </div>
{/if}
