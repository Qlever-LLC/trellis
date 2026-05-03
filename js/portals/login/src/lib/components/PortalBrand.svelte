<script lang="ts">
  interface Props {
    subtitle: string;
  }

  let { subtitle }: Props = $props();
</script>

<div class="inline-flex items-center gap-3.5">
  <span
    class="portal-brand-mark grid h-10 w-10 shrink-0 place-items-center rounded-[0.9rem] border border-base-300 bg-base-100 shadow-sm"
  >
    <svg
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      focusable="false"
      class="h-6 w-6"
    >
      <path
        d="M8 8h24l-3.25 5.25H22.7v18.5h-5.4v-18.5h-6.05L8 8Z"
        fill="currentColor"
      />
      <path
        d="M14 13.25 22.7 22M26 13.25l-8.7 8.7M17.3 26.5l5.4-5.4"
        stroke="var(--color-primary-content)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        opacity="0.72"
      />
      <path
        d="M11.25 13.25h17.5M17.3 31.75h5.4"
        stroke="var(--color-primary-content)"
        stroke-width="2"
        stroke-linecap="round"
        opacity="0.86"
      />
    </svg>
  </span>
  <span class="min-w-0">
    <span class="block text-[1.65rem] font-semibold leading-none tracking-[-0.035em]">
      Trellis
    </span>
    <span class="portal-eyebrow mt-1.5 block text-[0.68rem] font-semibold">
      {subtitle}
    </span>
  </span>
</div>
