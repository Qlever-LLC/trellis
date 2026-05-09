<script lang="ts">
  import { resolve } from "$app/paths";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
</script>

<section class="space-y-4">
  <PageToolbar title="Login portal selection" description="Contract-specific login portal selections moved to identity-envelope metadata.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals/login")}>Back to login guidance</a>
    {/snippet}
  </PageToolbar>

  <Panel title="Selections moved" eyebrow="Operator guidance">
    <p class="text-sm text-base-content/70">The standalone login portal selection APIs have been removed. Use the envelope view to inspect effective routing for identity envelopes and contract evidence.</p>
  </Panel>
</section>
