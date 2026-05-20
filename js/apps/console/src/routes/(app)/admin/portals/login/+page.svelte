<script lang="ts">
  import { resolve } from "$app/paths";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
</script>

<section class="space-y-4">
  <PageToolbar title="Portal policy" description="Portal routing is now expressed through deployment permissions and related metadata.">
    {#snippet actions()}
      <a class="btn btn-outline btn-sm" href={resolve("/admin/authority")}>Open authority</a>
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals")}>Portals</a>
    {/snippet}
  </PageToolbar>

  <Panel title="Policy moved" eyebrow="Operator guidance">
    <div class="space-y-3 text-sm text-base-content/70">
      <p>Default and contract-specific portal policy APIs have been removed. Use deployments to inspect permission metadata and portal route evidence.</p>
      <a class="btn btn-outline btn-sm" href={resolve("/admin/authority")}>Review authority</a>
    </div>
  </Panel>
</section>
