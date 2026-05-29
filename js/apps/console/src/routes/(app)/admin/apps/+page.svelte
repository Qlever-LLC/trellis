<script lang="ts">
  import type { AuthIdentityGrantsListOutput } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import ActionMenu from "$lib/components/ActionMenu.svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";
  import { isErr } from "@qlever-llc/result";

  const trellis = getTrellis();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let identityGrants = $state<AuthIdentityGrantsListOutput["entries"]>([]);

  async function load() {
    loading = true;
    error = null;

    const res = await trellis.request("Auth.IdentityGrants.List", { limit: 500, offset: 0 }).take();
    loading = false;
    if (isErr(res)) {
      error = errorMessage(res);
      return;
    }

    identityGrants = res.entries;
  }

  onMount(load);
</script>

<section class="space-y-4">
  <PageToolbar
    title="Delegated grants"
    description="Review and revoke delegated app and agent grants."
  >
    {#snippet actions()}
      <div class="trellis-filterbar-actions">
        <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>
          Refresh
        </button>
        <ActionMenu buttonBaseClass="btn btn-outline btn-sm" widthClass="w-64">
          {#snippet summary()}
            Actions <Icon name="chevronDown" size={14} />
          {/snippet}
          <li>
            <a href={resolve("/admin/apps/revoke")}>Revoke delegated grant</a>
          </li>
        </ActionMenu>
      </div>
    {/snippet}
  </PageToolbar>

  {#if error}
    <Notice variant="error">{error}</Notice>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading delegated grants" /></Panel>
  {:else if identityGrants.length === 0}
    <EmptyState
      title="No delegated grants"
      description="No app or agent identity grants are currently available."
    />
  {:else}
    <Panel title="Delegated grants" eyebrow="Primary table">
      <DataTable>
          <thead>
            <tr>
              <th>Principal</th>
              <th>Client</th>
              <th>Contract Digest</th>
              <th>Granted</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each identityGrants as entry (entry.identityGrantId)}
              <tr>
                <td class="font-medium">{entry.participantKind}</td>
                <td>
                  {entry.displayName ??
                    entry.contractEvidence.contractId ??
                    "—"}
                </td>
                <td class="trellis-identifier text-base-content/60">
                  {entry.contractEvidence.contractDigest.slice(0, 12)}…
                </td>
                <td class="text-base-content/60">
                  {formatDate(entry.grantedAt)}
                </td>
                <td class="text-right">
                  <ActionMenu>
                      <li>
                        <a
                          class="text-error"
                          href={resolve(
                            `/admin/apps/revoke?grant=${encodeURIComponent(entry.identityGrantId)}`,
                          )}>Revoke</a
                        >
                      </li>
                  </ActionMenu>
                </td>
              </tr>
            {/each}
          </tbody>
      </DataTable>
      <p class="text-xs text-base-content/50">
        {identityGrants.length} delegated grant{identityGrants.length !== 1 ? "s" : ""}
      </p>
    </Panel>
  {/if}
</section>
