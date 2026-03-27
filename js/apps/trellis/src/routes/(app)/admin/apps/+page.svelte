<script lang="ts">
  import type { AuthListApprovalsOutput } from "@qlever-llc/trellis-sdk-auth";
  import { getTrellisFor } from "@qlever-llc/trellis-svelte";
  import { onMount } from "svelte";
  import { trellisApp } from "../../../../contracts/trellis_app.ts";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { getNotifications } from "../../../../lib/notifications.svelte";

  const trellisPromise = getTrellisFor(trellisApp);
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let filterUser = $state("");
  let approvals = $state<AuthListApprovalsOutput["approvals"]>([]);
  let revokeTarget = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await (await trellisPromise).requestOrThrow("Auth.ListApprovals", {
        user: filterUser.trim() || undefined
      });
      approvals = res.approvals ?? [];
    } catch (e) { error = errorMessage(e); }
    finally { loading = false; }
  }

  async function revoke(contractDigest: string, user: string) {
    if (!window.confirm(`Revoke this approval for ${user}? The app will lose access.`)) return;
    const key = `${user}:${contractDigest}`;
    revokeTarget = key;
    try {
      await (await trellisPromise).requestOrThrow("Auth.RevokeApproval", { contractDigest, user });
      notifications.success(`Approval revoked for ${user}.`, "Revoked");
      await load();
    } catch (e) { error = errorMessage(e); }
    finally { revokeTarget = null; }
  }

  onMount(() => { void load(); });
</script>

<section class="space-y-4">
  <form class="flex gap-2 items-end" onsubmit={(e) => { e.preventDefault(); void load(); }}>
    <input class="input input-bordered input-sm w-60" placeholder="Filter by user…" bind:value={filterUser} />
    <button type="submit" class="btn btn-primary btn-sm" disabled={loading}>Apply</button>
    {#if filterUser.trim()}
      <button type="button" class="btn btn-ghost btn-sm" onclick={() => { filterUser = ""; void load(); }}>Clear</button>
    {/if}
    <div class="flex-1"></div>
    <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
  </form>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
  {:else if approvals.length === 0}
    <p class="text-sm text-base-content/60">No approvals found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
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
          {#each approvals as entry}
            <tr>
              <td class="font-medium">{entry.user ?? "—"}</td>
              <td>{entry.approval.displayName ?? entry.approval.contractId ?? "—"}</td>
              <td class="font-mono text-xs text-base-content/60">{entry.approval.contractDigest?.slice(0, 12)}…</td>
              <td class="text-base-content/60">{formatDate(entry.answeredAt)}</td>
              <td class="text-right">
                <button
                  class="btn btn-ghost btn-xs text-error"
                  onclick={() => revoke(entry.approval.contractDigest, entry.user)}
                  disabled={revokeTarget === `${entry.user}:${entry.approval.contractDigest}`}
                >
                  {revokeTarget === `${entry.user}:${entry.approval.contractDigest}` ? "Revoking…" : "Revoke"}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-base-content/50">{approvals.length} approval{approvals.length !== 1 ? "s" : ""}</p>
  {/if}
</section>
