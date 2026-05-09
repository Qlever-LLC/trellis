<script lang="ts">
  import { resolve } from "$app/paths";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
</script>

<section class="space-y-4">
  <PageToolbar title="Default login portal" description="Default login portal configuration moved to envelope metadata.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals/login")}>Back to login guidance</a>
    {/snippet}
  </PageToolbar>

  <Panel title="No standalone default" eyebrow="Operator guidance">
    <p class="text-sm text-base-content/70">The standalone default login portal API has been removed. Inspect identity envelopes for the effective login routing metadata.</p>
  </Panel>
</section>
