<script lang="ts">
  import { resolve } from "$app/paths";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
</script>

<section class="space-y-4">
  <PageToolbar title="Portal routing" description="Portal records are now deployment and envelope metadata, not standalone registry resources.">
    {#snippet actions()}
      <a class="btn btn-outline btn-sm" href={resolve("/admin/envelopes")}>Open envelopes</a>
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/deployments")}>Open deployments</a>
    {/snippet}
  </PageToolbar>

  <Panel title="Operator guidance" eyebrow="Clean-break auth API">
    <div class="space-y-3 text-sm text-base-content/70">
      <p>Portal routing moved into deployment and identity-envelope metadata. The removed portal RPCs are no longer called by Console.</p>
      <div class="flex flex-wrap gap-2">
        <a class="btn btn-outline btn-sm" href={resolve("/admin/envelopes")}>Review envelope portal routes</a>
        <a class="btn btn-ghost btn-sm" href={resolve("/admin/deployments")}>Inspect deployments</a>
      </div>
    </div>
  </Panel>
</section>
