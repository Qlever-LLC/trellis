<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type { AuthListApprovalsOutput } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  type ApprovalEntry = AuthListApprovalsOutput["approvals"][number];

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let pending = $state(false);
  let approvals = $state<ApprovalEntry[]>([]);
  let selectedKey = $state("");

  const selectedApproval = $derived(approvals.find((entry) => `${entry.user}:${entry.approval.contractDigest}` === selectedKey) ?? null);

  async function load() {
    loading = true;
    error = null;
    try {
      const requestedUser = page.url.searchParams.get("user") ?? undefined;
      const requestedDigest = page.url.searchParams.get("contractDigest");
      const response = await trellis.request("Auth.ListApprovals", { user: requestedUser }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      approvals = response.approvals ?? [];
      const match = approvals.find((entry) => entry.user === requestedUser && entry.approval.contractDigest === requestedDigest) ?? approvals[0] ?? null;
      selectedKey = match ? `${match.user}:${match.approval.contractDigest}` : "";
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function revokeApproval() {
    if (!selectedApproval) return;
    pending = true;
    error = null;
    try {
      const response = await trellis.request("Auth.RevokeApproval", {
        contractDigest: selectedApproval.approval.contractDigest,
        user: selectedApproval.user,
      }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Approval revoked for ${selectedApproval.user}.`, "Revoked");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      pending = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Revoke app approval" description="Confirm and revoke a per-user app approval.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/apps")}>Back to approvals</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading approvals" /></Panel>
  {:else if approvals.length === 0}
    <EmptyState title="No approvals" description="No app approvals are available to revoke." />
  {:else}
    <Panel title="Confirm revoke" eyebrow="Workflow">
      <div class="space-y-4">
        <label class="form-control gap-1">
          <span class="label-text text-xs">Approval</span>
          <select class="select select-bordered select-sm" bind:value={selectedKey} required>
            {#each approvals as entry (`${entry.user}:${entry.approval.contractDigest}`)}
              <option value={`${entry.user}:${entry.approval.contractDigest}`}>{entry.user} — {entry.approval.displayName ?? entry.approval.contractId ?? entry.approval.contractDigest}</option>
            {/each}
          </select>
        </label>

        {#if selectedApproval}
          <div class="rounded-box border border-base-300 p-3 text-sm">
            <div class="font-medium">{selectedApproval.approval.displayName ?? selectedApproval.approval.contractId ?? "App approval"}</div>
            <div class="text-base-content/60">User: {selectedApproval.user}</div>
            <div class="font-mono text-xs text-base-content/60">{selectedApproval.approval.contractDigest}</div>
            <div class="text-xs text-base-content/60">Approved {formatDate(selectedApproval.answeredAt)}</div>
          </div>
        {/if}

        <div class="flex flex-wrap gap-2">
          <button class="btn btn-error btn-sm" onclick={revokeApproval} disabled={!selectedApproval || pending}>{pending ? "Revoking..." : "Revoke approval"}</button>
          <a class="btn btn-ghost btn-sm" href={resolve("/admin/apps")}>Cancel</a>
        </div>
      </div>
    </Panel>
  {/if}
</section>
