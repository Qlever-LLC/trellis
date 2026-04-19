<script lang="ts">
  import { page } from "$app/state";
  import type { Snippet } from "svelte";
  import { inspectionLinks } from "$lib/inspection-links";
  import TrellisProviderHost from "$lib/TrellisProviderHost.svelte";
  import { trellisUrl } from "$lib/trellis";

  let { children }: { children: Snippet } = $props();

  const currentPath = $derived($state.eager(page.url.pathname));
</script>

<TrellisProviderHost trellisUrl={trellisUrl} loginPath="/login">
  {#snippet loading()}
    <section class="page-shell">
      <div class="panel stack panel-strong">
        <p class="eyebrow">Connecting</p>
        <h1>Opening the field inspection workspace</h1>
        <p class="page-summary">Trellis is restoring your authenticated runtime and route context.</p>
      </div>
    </section>
  {/snippet}

  <section class="page-shell layout-grid">
    <aside class="panel stack panel-strong">
      <div class="stack">
        <p class="eyebrow">Packet 8 · Phase 5</p>
        <h1>Field inspection browser</h1>
        <p class="page-summary">A small authenticated app shell driven by TrellisProvider and the live demo surfaces.</p>
      </div>

      <nav class="stack" aria-label="Demo routes">
        {#each inspectionLinks as link (link.href)}
          <a class="nav-link" href={link.href} aria-current={currentPath === link.href ? "page" : undefined}>
            <strong>{link.label}</strong>
            <span>{link.detail}</span>
          </a>
        {/each}
      </nav>

      <div class="panel stack">
        <span class="kicker">Authenticated layout</span>
        <p class="status-line">The route group holds the live Trellis client in context. Login stays outside this shell.</p>
      </div>
    </aside>

    <main class="stack">
      {@render children()}
    </main>
  </section>
</TrellisProviderHost>
