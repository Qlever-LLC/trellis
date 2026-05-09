<script lang="ts">
  import { resolve } from "$app/paths";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
</script>

<section class="space-y-4">
  <PageToolbar title="Device portal selection" description="Deployment-specific portal selections moved to deployment and envelope metadata.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals/devices")}>Back to device guidance</a>
    {/snippet}
  </PageToolbar>

  <Panel title="Selections moved" eyebrow="Operator guidance">
    <p class="text-sm text-base-content/70">The standalone device portal selection APIs have been removed. Use deployments and envelopes to inspect effective device portal routing.</p>
  </Panel>
</section>
