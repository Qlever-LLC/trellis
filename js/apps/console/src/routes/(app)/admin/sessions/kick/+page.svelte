<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type { AuthConnectionsKickInput } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import ConfirmationModal from "$lib/components/ConfirmationModal.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { describeSessionPrincipal, formatShortKey, participantKindLabel, type ConnectionRecord } from "../../../../../lib/auth_display.ts";
  import { errorMessage, formatDate } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let pending = $state(false);
  let connections = $state<ConnectionRecord[]>([]);
  let selectedUserNkey = $state("");
  let confirmationModal: ConfirmationModal | undefined = $state();

  const selectedConnection = $derived(connections.find((connection) => connection.userNkey === selectedUserNkey) ?? null);

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await trellis.request("Auth.Connections.List", { limit: 500, offset: 0 }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      connections = response.entries ?? [];
      const requestedUserNkey = page.url.searchParams.get("userNkey");
      selectedUserNkey = requestedUserNkey && connections.some((connection) => connection.userNkey === requestedUserNkey) ? requestedUserNkey : (connections[0]?.userNkey ?? "");
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function kickConnection() {
    if (!selectedConnection) return;
    const summary = describeSessionPrincipal(selectedConnection);
    pending = true;
    error = null;
    try {
      const response = await trellis.request("Auth.Connections.Kick", { userNkey: selectedConnection.userNkey } satisfies AuthConnectionsKickInput).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Disconnected ${summary.title}.`, "Kicked");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      pending = false;
    }
  }

  async function requestKickConnection() {
    if (!selectedConnection) return;
    const summary = describeSessionPrincipal(selectedConnection);
    const confirmed = await confirmationModal?.confirm({
      title: "Kick connection?",
      message: "This immediately disconnects the selected active connection.",
      confirmLabel: "Kick connection",
      targetLabel: summary.title,
      targetName: selectedConnection.userNkey,
      expectedValue: selectedConnection.userNkey,
    });
    if (confirmed) await kickConnection();
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Kick connection" description="Confirm and disconnect an active connection.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/sessions")}>Back to sessions</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <Notice variant="error">{error}</Notice>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading connections" /></Panel>
  {:else if connections.length === 0}
    <EmptyState title="No connections" description="No active connections are available to kick." />
  {:else}
    <Panel title="Confirm kick" eyebrow="Workflow">
      <div class="space-y-4">
        <label class="form-control gap-1">
          <span class="label-text text-xs">Connection</span>
          <select class="select select-bordered select-sm" bind:value={selectedUserNkey} required>
            {#each connections as connection (connection.key)}
              {@const summary = describeSessionPrincipal(connection)}
              <option value={connection.userNkey}>{summary.title} — {formatShortKey(connection.userNkey)}</option>
            {/each}
          </select>
        </label>

        {#if selectedConnection}
          {@const summary = describeSessionPrincipal(selectedConnection)}
          <div class="rounded-box border border-base-300 p-3 text-sm">
            <div class="font-medium">{summary.title}</div>
            <div class="text-base-content/60">{participantKindLabel(selectedConnection.participantKind)}</div>
            <div class="trellis-identifier text-base-content/60">{selectedConnection.userNkey}</div>
            <div class="text-xs text-base-content/60">Connected {formatDate(selectedConnection.connectedAt)}</div>
          </div>
        {/if}

        <div class="flex flex-wrap gap-2">
          <button class="btn btn-error btn-sm" onclick={requestKickConnection} disabled={!selectedConnection || pending}>{pending ? "Kicking..." : "Kick connection"}</button>
          <a class="btn btn-ghost btn-sm" href={resolve("/admin/sessions")}>Cancel</a>
        </div>
      </div>
    </Panel>
  {/if}
</section>

<ConfirmationModal bind:this={confirmationModal} />
