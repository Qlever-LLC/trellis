<script lang="ts">
  type LogoVariant = "compact" | "full" | "landing";

  let {
    variant = "full",
    label = "Field Inspection Desk",
    relationship = "Powered by Trellis",
  }: {
    variant?: LogoVariant;
    label?: string;
    relationship?: string;
  } = $props();

  const labelId = $props.id();
  const showWordmark = $derived(variant !== "compact");
  const showRelationship = $derived(variant === "landing");
</script>

<span
  class={["demo-client-logo", `demo-client-logo-${variant}`]}
  role="img"
  aria-labelledby={labelId}
>
  <svg class="logo-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <rect class="mark-frame" x="5" y="5" width="38" height="38" rx="9" />
    <path class="mark-lane" d="M13 15h22" />
    <path class="mark-lane" d="M13 24h22" />
    <path class="mark-lane" d="M13 33h22" />
    <path class="mark-grid" d="M18 11v26" />
    <path class="mark-grid" d="M29 11v26" />
    <path class="mark-desk" d="M13 38h22" />
    <path class="mark-checkpoint" d="M34.5 15.5c0 5.7-6 9.2-6 9.2s-6-3.5-6-9.2a6 6 0 1 1 12 0Z" />
    <circle class="mark-dot" cx="28.5" cy="15.5" r="2.1" />
  </svg>

  {#if showWordmark}
    <span class="logo-copy">
      <span class="logo-label" id={labelId}>{label}</span>
      {#if showRelationship}
        <span class="logo-relationship">{relationship}</span>
      {/if}
    </span>
  {:else}
    <span id={labelId} class="sr-only">{label}</span>
  {/if}
</span>

<style>
  .demo-client-logo {
    --logo-ink: #101828;
    --logo-blue: #243b53;
    --logo-copper: #b86b35;
    --logo-stone: #c8c2b8;
    align-items: center;
    color: var(--logo-ink);
    display: inline-flex;
    gap: 0.75rem;
    min-width: 0;
  }

  .demo-client-logo-compact {
    gap: 0;
  }

  .demo-client-logo-landing {
    gap: 0.95rem;
  }

  .logo-mark {
    display: block;
    flex: 0 0 auto;
    height: 2rem;
    width: 2rem;
  }

  .demo-client-logo-landing .logo-mark {
    height: 3.75rem;
    width: 3.75rem;
  }

  .mark-frame {
    fill: #f5f3ef;
    stroke: var(--logo-ink);
    stroke-width: 2.2;
  }

  .mark-lane,
  .mark-grid,
  .mark-desk {
    fill: none;
    stroke-linecap: round;
  }

  .mark-lane {
    stroke: var(--logo-blue);
    stroke-width: 1.8;
  }

  .mark-grid {
    opacity: 0.72;
    stroke: var(--logo-stone);
    stroke-width: 1.6;
  }

  .mark-desk {
    stroke: var(--logo-ink);
    stroke-width: 2.2;
  }

  .mark-checkpoint {
    fill: var(--logo-copper);
    stroke: #f5f3ef;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }

  .mark-dot {
    fill: #f5f3ef;
  }

  .logo-copy {
    display: inline-flex;
    flex-direction: column;
    line-height: 1.05;
    min-width: 0;
  }

  .logo-label {
    color: var(--logo-ink);
    font-size: 0.95rem;
    font-weight: 900;
    letter-spacing: -0.03em;
    overflow-wrap: anywhere;
  }

  .demo-client-logo-landing .logo-label {
    font-size: clamp(1.45rem, 4vw, 2.35rem);
  }

  .logo-relationship {
    color: var(--logo-copper);
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.2em;
    margin-top: 0.35rem;
    text-transform: uppercase;
  }

  .sr-only {
    border: 0;
    clip: rect(0, 0, 0, 0);
    height: 1px;
    margin: -1px;
    overflow: hidden;
    padding: 0;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }
</style>
