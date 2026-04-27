<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { describeUserGrant, participantKindLabel, type UserGrantRecord } from "../../../../../lib/auth_display.ts";
  import { errorMessage, formatDate } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  type RevokeUserGrantInput = { contractDigest: string };

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let pending = $state(false);
  let grants = $state<UserGrantRecord[]>([]);
  let selectedGrantDigest = $state("");

  const selectedGrant = $derived(grants.find((grant) => grant.contractDigest === selectedGrantDigest) ?? null);

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await trellis.request("Auth.ListUserGrants", {}).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      grants = response.grants ?? [];
      const requestedGrant = page.url.searchParams.get("grant");
      selectedGrantDigest = requestedGrant && grants.some((grant) => grant.contractDigest === requestedGrant) ? requestedGrant : (grants[0]?.contractDigest ?? "");
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
      const response = await trellis.request("Auth.RevokeUserGrant", { contractDigest: selectedGrant.contractDigest } satisfies RevokeUserGrantInput).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`${participantKindLabel(selectedGrant.participantKind)} grant revoked.`, "Revoked");
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
  <PageToolbar title="Revoke delegated grant" description="Confirm and revoke a grant that acts on your behalf.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/profile")}>Back to profile</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading delegated grants" /></Panel>
  {:else if grants.length === 0}
    <EmptyState title="No delegated grants" description="No apps or agents currently act on your behalf." />
  {:else}
    <Panel title="Confirm revoke" eyebrow="Workflow">
      <div class="space-y-4">
        <label class="form-control gap-1">
          <span class="label-text text-xs">Grant</span>
          <select class="select select-bordered select-sm" bind:value={selectedGrantDigest} required>
            {#each grants as grant (grant.contractDigest)}
              {@const summary = describeUserGrant(grant)}
              <option value={grant.contractDigest}>{summary.title} — {grant.contractId}</option>
            {/each}
          </select>
        </label>

        {#if selectedGrant}
          {@const summary = describeUserGrant(selectedGrant)}
          <div class="rounded-box border border-base-300 p-3 text-sm">
            <div class="font-medium">{summary.title}</div>
            <div class="text-base-content/60">{summary.details}</div>
            <div class="font-mono text-xs text-base-content/60">{selectedGrant.contractDigest}</div>
            <div class="text-xs text-base-content/60">Granted {formatDate(selectedGrant.grantedAt)}</div>
          </div>
        {/if}

        <div class="flex flex-wrap gap-2">
          <button class="btn btn-error btn-sm" onclick={revokeGrant} disabled={!selectedGrant || pending}>{pending ? "Revoking..." : "Revoke grant"}</button>
          <a class="btn btn-ghost btn-sm" href={resolve("/profile")}>Cancel</a>
        </div>
      </div>
    </Panel>
  {/if}
</section>
