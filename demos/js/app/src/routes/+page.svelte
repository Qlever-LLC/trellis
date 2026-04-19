<script lang="ts">
  import { inspectionLinks, type InspectionLink } from "../lib/inspection-links";

  const scenarioTitle = "Field inspection";
  const links: readonly InspectionLink[] = inspectionLinks;
</script>

<svelte:head>
  <title>Field Inspection Demo</title>
  <meta
    name="description"
    content="Minimal landing page for the Trellis field-inspection demo flows."
  />
</svelte:head>

<section class="shell">
  <p class="eyebrow">Packet 8 · Phase 5</p>
  <h1>{scenarioTitle}</h1>
  <p class="summary">
    Sign in once, then jump between typed Trellis demos for RPC, operations, transfer, KV-backed reads, jobs, and schema-backed client state stores.
  </p>

  <div class="hero-actions">
    <a class="hero-link hero-link-primary" href="/login?redirectTo=/rpc">Enter authenticated demo</a>
    <a class="hero-link" href="/rpc">Open the first route directly</a>
  </div>

  <ul class="link-list">
    {#each links as link (link.href)}
      <li>
        <a class="link-card" href={link.href}>
          <span class="label">{link.label}</span>
          <span class="detail">{link.detail}</span>
        </a>
      </li>
    {/each}
  </ul>
</section>

<style>
  .shell {
    box-sizing: border-box;
    max-width: 56rem;
    margin: 0 auto;
    padding: 4rem 1.5rem 5rem;
  }

  .eyebrow {
    margin: 0 0 0.75rem;
    color: #8fb7ff;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: clamp(2.25rem, 5vw, 4rem);
    line-height: 1.05;
  }

  .summary {
    max-width: 42rem;
    margin: 1rem 0 2rem;
    color: #bdd0f0;
    font-size: 1.05rem;
    line-height: 1.6;
  }

  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.85rem;
    margin-bottom: 1.75rem;
  }

  .hero-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 2.9rem;
    padding: 0 1.1rem;
    border: 1px solid rgba(143, 183, 255, 0.24);
    border-radius: 999px;
    text-decoration: none;
    color: #d7e4f8;
    background: rgba(11, 18, 36, 0.72);
  }

  .hero-link-primary {
    border-color: rgba(143, 183, 255, 0.44);
    background: linear-gradient(180deg, rgba(117, 154, 220, 0.32), rgba(72, 103, 167, 0.22));
  }

  .link-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 1rem;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .link-card {
    display: grid;
    gap: 0.45rem;
    min-height: 8.5rem;
    padding: 1rem;
    border: 1px solid rgba(143, 183, 255, 0.16);
    border-radius: 0.9rem;
    background: rgba(11, 18, 36, 0.72);
    text-decoration: none;
    transition:
      transform 120ms ease,
      border-color 120ms ease,
      background 120ms ease;
  }

  .link-card:hover,
  .link-card:focus-visible {
    transform: translateY(-1px);
    border-color: rgba(143, 183, 255, 0.5);
    background: rgba(20, 31, 58, 0.9);
  }

  .label {
    font-size: 1rem;
    font-weight: 700;
  }

  .detail {
    color: #bdd0f0;
    line-height: 1.5;
  }
</style>
