<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type Portal = {
    portalId: string;
    displayName: string;
    entryUrl: string | null;
    builtIn: boolean;
    disabled: boolean;
    createdAt: string;
    updatedAt: string;
  };

  const trellis = getTrellis();
  let loading = $state(true);
  let error = $state<string | null>(null);
  let portals = $state.raw<Portal[]>([]);
  const activeCount = $derived(portals.filter((portal) => !portal.disabled).length);

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await trellis.request("Auth.Portals.List", {}).take();
      if (isErr(response)) {
        error = errorMessage(response);
        return;
      }
      portals = response.portals;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => { void load(); });
</script>

<section class="space-y-4">
  <PageToolbar title="Portal routing" description="Login portal registry and route selection state.">
    {#snippet actions()}
      <a class="btn btn-outline btn-sm" href={resolve("/admin/portals/login/default")}>Default login</a>
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals/login/selection")}>Route selection</a>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading portals" /></Panel>
  {:else if portals.length === 0}
    <EmptyState title="No portals" description="No visible login portals are projected." />
  {:else}
    <Panel title="Login portals" eyebrow={`${activeCount} active / ${portals.length} visible`} class="overflow-hidden">
      <div class="overflow-x-auto">
        <table class="table table-sm trellis-table border-b border-base-300 bg-base-100/30">
          <thead>
            <tr>
              <th>Portal</th>
              <th class="hidden md:table-cell">Entry URL</th>
              <th>Mode</th>
              <th>Status</th>
              <th class="hidden lg:table-cell">Updated</th>
            </tr>
          </thead>
          <tbody>
            {#each portals as portal (portal.portalId)}
              <tr>
                <td>
                  <div class="font-medium">{portal.displayName}</div>
                  <div class="font-mono text-xs text-base-content/55">{portal.portalId}</div>
                </td>
                <td class="hidden max-w-[26rem] truncate font-mono text-xs md:table-cell">{portal.entryUrl ?? "built-in"}</td>
                <td><span class="badge badge-sm {portal.builtIn ? 'badge-info' : 'badge-neutral'}">{portal.builtIn ? "built-in" : "external"}</span></td>
                <td><span class="badge badge-sm {portal.disabled ? 'badge-neutral' : 'badge-success'}">{portal.disabled ? "disabled" : "active"}</span></td>
                <td class="hidden text-xs text-base-content/60 lg:table-cell">{formatDate(portal.updatedAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </Panel>
  {/if}
</section>
