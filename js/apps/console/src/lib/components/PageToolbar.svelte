<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    title: string;
    description?: string;
    actions?: Snippet;
    meta?: Snippet;
    class?: string;
  };

  let { title, description, actions, meta, class: className = "" }: Props = $props();
</script>

<div class={["mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className]}>
  <div class="min-w-0">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="truncate text-3xl font-semibold tracking-tight text-base-content">{title}</h1>
      {@render meta?.()}
    </div>
    {#if description}
      <p class="mt-1 max-w-3xl text-sm text-base-content/60">{description}</p>
    {/if}
  </div>
  {#if actions}
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      {@render actions()}
    </div>
  {/if}
</div>
