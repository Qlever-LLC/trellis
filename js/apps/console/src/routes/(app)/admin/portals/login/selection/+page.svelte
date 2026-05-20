<script lang="ts">
  import { resolve } from "$app/paths";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
</script>

<section class="space-y-4">
  <PageToolbar title="Portal routes moved" description="Login route rules are now scoped to each portal record.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals")}>Back to portals</a>
    {/snippet}
  </PageToolbar>

  <Panel title="Manage routes from a portal" eyebrow="Clean-break route API">
    <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <p class="text-base-content/60">Open a portal record, then add or edit its contract and origin route rules from the Portal routes panel.</p>
      <a class="btn btn-outline btn-sm" href={resolve("/admin/portals")}>View portals</a>
    </div>
  </Panel>
</section>
