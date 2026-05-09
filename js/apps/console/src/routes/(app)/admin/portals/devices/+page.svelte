<script lang="ts">
  import { resolve } from "$app/paths";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
</script>

<section class="space-y-4">
  <PageToolbar title="Device portal policy" description="Device portal routing is now deployment and envelope metadata.">
    {#snippet actions()}
      <a class="btn btn-outline btn-sm" href={resolve("/admin/deployments")}>Open deployments</a>
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/envelopes")}>Open envelopes</a>
    {/snippet}
  </PageToolbar>

  <Panel title="Policy moved" eyebrow="Operator guidance">
    <div class="space-y-3 text-sm text-base-content/70">
      <p>Default and deployment-specific device portal APIs have been removed. Use deployments and envelopes to inspect activation routes and authority metadata.</p>
      <div class="flex flex-wrap gap-2">
        <a class="btn btn-outline btn-sm" href={resolve("/admin/deployments")}>Inspect deployments</a>
        <a class="btn btn-ghost btn-sm" href={resolve("/admin/envelopes")}>Review envelopes</a>
      </div>
    </div>
  </Panel>
</section>
