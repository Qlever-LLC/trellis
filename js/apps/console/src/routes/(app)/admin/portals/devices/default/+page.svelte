<script lang="ts">
  import { resolve } from "$app/paths";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
</script>

<section class="space-y-4">
  <PageToolbar title="Default device portal" description="Default device portal configuration moved to deployment metadata.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals/devices")}>Back to device guidance</a>
    {/snippet}
  </PageToolbar>

  <Panel title="No standalone default" eyebrow="Operator guidance">
    <p class="text-sm text-base-content/70">The standalone default device portal API has been removed. Inspect deployments and envelopes for effective device onboarding routes.</p>
  </Panel>
</section>
