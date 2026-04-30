<script lang="ts">
  import type { AuthListApprovalsOutput } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";
  import { isErr } from "@qlever-llc/result";

  const trellis = getTrellis();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let filterUser = $state("");
  let approvals = $state<AuthListApprovalsOutput["approvals"]>([]);

  async function load() {
    loading = true;
    error = null;

    const user = filterUser.trim();
    const res = await trellis.request("Auth.ListApprovals", { user }).take();
    loading = false;
    if (isErr(res)) {
      error = errorMessage(res);
      return;
    }

    approvals = res.approvals;
  }

  onMount(load);
</script>

<section class="space-y-4">
  <PageToolbar
    title="App approvals"
    description="Review and revoke per-user app approvals."
  >
    {#snippet actions()}
      <div class="trellis-filterbar-actions">
        <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>
          Refresh
        </button>
        <details class="dropdown dropdown-end">
          <summary class="btn btn-outline btn-sm">
            Actions <Icon name="chevronDown" size={14} />
          </summary>
          <ul class="menu dropdown-content trellis-dropdown-menu w-64">
            <li>
              <a href={resolve("/admin/apps/revoke")}>Revoke an approval</a>
            </li>
          </ul>
        </details>
      </div>
    {/snippet}
  </PageToolbar>

  <form
    class="trellis-filterbar"
    onsubmit={(e) => {
      e.preventDefault();
      void load();
    }}
  >
    <div class="trellis-filterbar-controls">
      <label class="trellis-field w-full sm:w-72">
        <span class="trellis-field-label">User</span>
        <input
          class="input input-bordered input-sm"
          placeholder="Filter by user…"
          bind:value={filterUser}
        />
      </label>
    </div>
    <div class="trellis-filterbar-actions">
      <button type="submit" class="btn btn-outline btn-sm" disabled={loading}>Apply</button>
      {#if filterUser.trim()}
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onclick={() => {
            filterUser = "";
            void load();
          }}>Clear</button
        >
      {/if}
    </div>
  </form>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading app approvals" /></Panel>
  {:else if approvals.length === 0}
    <EmptyState
      title="No approvals"
      description="No app approvals match the current filter."
    />
  {:else}
    <Panel title="Approvals" eyebrow="Primary table">
      <div class="overflow-x-auto">
        <table class="table table-sm trellis-table">
          <thead>
            <tr>
              <th>User</th>
              <th>App</th>
              <th>Contract Digest</th>
              <th>Approved</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each approvals as entry (`${entry.user}:${entry.approval.contractDigest}:${entry.answeredAt}`)}
              <tr>
                <td class="font-medium">{entry.user ?? "—"}</td>
                <td>
                  {entry.approval.displayName ??
                    entry.approval.contractId ??
                    "—"}
                </td>
                <td class="trellis-identifier text-base-content/60">
                  {entry.approval.contractDigest?.slice(0, 12)}…
                </td>
                <td class="text-base-content/60">
                  {formatDate(entry.answeredAt)}
                </td>
                <td class="text-right">
                  <details class="dropdown dropdown-end">
                    <summary class="btn btn-ghost btn-xs">Actions</summary>
                    <ul class="menu dropdown-content trellis-dropdown-menu w-48">
                      <li>
                        <a
                          class="text-error"
                          href={resolve(
                            `/admin/apps/revoke?contractDigest=${encodeURIComponent(entry.approval.contractDigest)}&user=${encodeURIComponent(entry.user)}`,
                          )}>Revoke</a
                        >
                      </li>
                    </ul>
                  </details>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="text-xs text-base-content/50">
        {approvals.length} approval{approvals.length !== 1 ? "s" : ""}
      </p>
    </Panel>
  {/if}
</section>
