<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    title?: string;
    eyebrow?: string;
    children: Snippet;
    actions?: Snippet;
    footer?: Snippet;
    class?: string;
  };

  let { title, eyebrow, children, actions, footer, class: className = "" }: Props = $props();
</script>

<section class={["card trellis-card bg-base-100", className]}>
  {#if title || eyebrow || actions}
    <div class="border-b border-base-300 px-5 py-4">
      <div class="flex min-h-6 items-center justify-between gap-3">
        <div class="min-w-0">
          {#if eyebrow}
            <p class="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-base-content/45">{eyebrow}</p>
          {/if}
          {#if title}
            <h2 class="card-title truncate text-base font-bold leading-none">{title}</h2>
          {/if}
        </div>
        {#if actions}
          <div class="flex shrink-0 items-center gap-2">
            {@render actions()}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <div class="card-body p-5">
    {@render children()}
  </div>

  {#if footer}
    <div class="border-t border-base-300 px-4 py-3 text-sm text-base-content/60">
      {@render footer()}
    </div>
  {/if}
</section>
