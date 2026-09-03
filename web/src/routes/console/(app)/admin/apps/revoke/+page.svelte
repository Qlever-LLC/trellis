<script lang="ts">
  import { ulid } from "ulid";
  import { isErr } from "@qlever-llc/result";
  import type { AuthIdentityAuthorityListOutput } from "@trellis/apis/trellis.auth";
  import { resolve } from "$lib/console_paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import ConfirmationModal from "$lib/components/ConfirmationModal.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getNotifications } from "$lib/notifications.svelte";
  import { getTrellis } from "$lib/trellis";

  type IdentityGrantEntry = AuthIdentityAuthorityListOutput["entries"][number];

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let pending = $state(false);
  let identityGrants = $state<IdentityGrantEntry[]>([]);
  let selectedKey = $state("");
  let confirmationModal: ConfirmationModal | undefined = $state();

  const selectedGrant = $derived(identityGrants.find((entry) => entry.authorityId === selectedKey) ?? null);

  async function load() {
    loading = true;
    error = null;
    try {
      const requestedGrant = page.url.searchParams.get("grant");
      const response = await trellis.authIdentityAuthorityList({ limit: 100 }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      identityGrants = response.entries ?? [];
      const match = identityGrants.find((entry) => entry.authorityId === requestedGrant) ?? identityGrants[0] ?? null;
      selectedKey = match?.authorityId ?? "";
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function revokeGrant() {
    if (!selectedGrant) return;
    pending = true;
    error = null;
    try {
      const response = await trellis.authIdentityAuthorityRevoke({
        authorityId: selectedGrant.authorityId,
        expectedVersion: selectedGrant.version,
        idempotencyKey: ulid(),
        reason: null,
      }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success("Delegated grant revoked.", "Revoked");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      pending = false;
    }
  }

  async function requestRevokeGrant() {
    if (!selectedGrant) return;
    const confirmed = await confirmationModal?.confirm({
      title: "Revoke delegated grant?",
      message: "This removes the selected delegated app or agent grant.",
      confirmLabel: "Revoke grant",
      targetLabel: selectedGrant.participantId,
      targetName: selectedGrant.authorityId,
      expectedValue: selectedGrant.authorityId,
    });
    if (confirmed) await revokeGrant();
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Revoke delegated grant" description="Confirm and revoke a delegated app or agent identity grant.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/apps")}>Back to delegated grants</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <Notice variant="error">{error}</Notice>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading delegated grants" /></Panel>
  {:else if identityGrants.length === 0}
    <EmptyState title="No delegated grants" description="No app or agent identity grants are available to revoke." />
  {:else}
    <Panel title="Confirm revoke" eyebrow="Workflow">
      <div class="space-y-4">
        <label class="form-control gap-1">
          <span class="label-text text-xs">Delegated grant</span>
          <select class="select select-bordered select-sm" bind:value={selectedKey} required>
            {#each identityGrants as entry (entry.authorityId)}
              <option value={entry.authorityId}>{entry.participantId}</option>
            {/each}
          </select>
        </label>

        {#if selectedGrant}
          <div class="rounded-box border border-base-300 p-3 text-sm">
            <div class="font-medium">{selectedGrant.participantId}</div>
            <div class="text-base-content/60">{selectedGrant.state}</div>
            <div class="trellis-identifier text-base-content/60">{selectedGrant.authorityId}</div>
            <div class="trellis-identifier text-base-content/60">{selectedGrant.participantArtifactDigest}</div>
            <div class="text-xs text-base-content/60">Granted {formatDate(selectedGrant.createdAt)}</div>
          </div>
        {/if}

        <div class="flex flex-wrap gap-2">
          <button class="btn btn-error btn-sm" onclick={requestRevokeGrant} disabled={!selectedGrant || pending}>{pending ? "Revoking..." : "Revoke grant"}</button>
          <a class="btn btn-ghost btn-sm" href={resolve("/admin/apps")}>Cancel</a>
        </div>
      </div>
    </Panel>
  {/if}
</section>

<ConfirmationModal bind:this={confirmationModal} />
