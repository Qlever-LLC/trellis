<script lang="ts">
  import type { ClassValue } from "svelte/elements";

  type Props = {
    class?: ClassValue;
    markClass?: ClassValue;
    titleClass?: ClassValue;
    subtitle?: string;
    subtitleClass?: ClassValue;
  };

  let {
    class: className,
    markClass,
    titleClass,
    subtitle,
    subtitleClass,
  }: Props = $props();
</script>

<span class={["inline-flex items-center gap-3", className]}>
  <span class={["grid h-9 w-9 shrink-0 place-items-center text-accent", markClass]}>
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false" class="h-7 w-7">
      <path d="M8 8h24l-3.25 5.25H22.7v18.5h-5.4v-18.5h-6.05L8 8Z" fill="currentColor" />
      <path d="M14 13.25 22.7 22M26 13.25l-8.7 8.7M17.3 26.5l5.4-5.4" stroke="var(--color-accent-content)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.72" />
      <path d="M11.25 13.25h17.5M17.3 31.75h5.4" stroke="var(--color-accent-content)" stroke-width="2" stroke-linecap="round" opacity="0.86" />
    </svg>
  </span>

  <span class="min-w-0">
    <span class={["block text-2xl font-semibold leading-none tracking-tight", titleClass]}>Trellis</span>
    {#if subtitle}
      <span class={["mt-1 block text-[10px] font-semibold uppercase tracking-[0.18em]", subtitleClass]}>{subtitle}</span>
    {/if}
  </span>
</span>
