<script lang="ts">
  import { ulid } from "ulid";
  import { isErr } from "@qlever-llc/result";
  import { resolve } from "$lib/console_paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import {
    describeSessionPrincipal,
    formatShortKey,
    participantKindBadgeClass,
    participantKindLabel,
    type ConnectionRecord,
    type SessionRecord,
  } from "$lib/auth_display.ts";
  import { errorMessage, formatDate } from "$lib/format";
  import ActionMenu from "$lib/components/ActionMenu.svelte";
  import BulkActionBar from "$lib/components/BulkActionBar.svelte";
  import BulkResult from "$lib/components/BulkResult.svelte";
  import ConfirmationModal from "$lib/components/ConfirmationModal.svelte";
  import Term from "$lib/components/Term.svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { getTrellis } from "$lib/trellis";
  import { bulkExpectedCount, bulkTargetDetails, runBulk, toggleAll, toggleId } from "$lib/bulk.ts";

  const trellis = getTrellis();

  let activeTab = $state<"sessions" | "connections">(page.url.searchParams.get("tab") === "connections" ? "connections" : "sessions");
  let handledTabParam = page.url.searchParams.get("tab");

  $effect(() => {
    const value = page.url.searchParams.get("tab");
    if (value === handledTabParam) return;
    handledTabParam = value;
    if (value === "connections" && activeTab !== "connections") {
      activeTab = "connections";
      void loadConnections();
    }
  });
  let loading = $state(true);
  let error = $state<string | null>(null);

  let sessions = $state<SessionRecord[]>([]);
  let sessionFilterUser = $state("");
  let currentSessionId = $state<string | null>(null);

  let connections = $state<ConnectionRecord[]>([]);
  let connFilterUser = $state("");
  let connFilterSessionKey = $state("");

  let selectedSessions = $state(new Set<string>());
  let selectedConnections = $state(new Set<string>());
  let bulkBusy = $state(false);
  let sessionResult = $state<{ succeeded: number; failed: string[] } | null>(null);
  let connectionResult = $state<{ succeeded: number; failed: string[] } | null>(null);
  let failedTargets = $state.raw<SessionRecord[]>([]);
  let confirmationModal: ConfirmationModal | undefined = $state();

  const revocableSessions = $derived(sessions.filter((session) => !isCurrentSession(session)));
  const selectableSessionIds = $derived(revocableSessions.map((session) => session.sessionId));
  const selectableConnectionIds = $derived(connections.map((connection) => connection.connectionId));

  async function loadSessions() {
    loading = true;
    error = null;
    try {
      currentSessionId = (await trellis.authSessionsMe({}).orThrow()).session.sessionId;
      const response = await trellis.authSessionsList({
        principalId: sessionFilterUser.trim() || undefined,
        limit: 100,
      }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      sessions = response.entries ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function loadConnections() {
    loading = true;
    error = null;
    try {
      const response = await trellis.authConnectionsList({
        sessionId: connFilterSessionKey.trim() || undefined,
        limit: 100,
      }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      connections = response.entries ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  function loadActive() {
    if (activeTab === "sessions") void loadSessions();
    else void loadConnections();
  }

  function isCurrentSession(session: SessionRecord): boolean {
    return session.sessionId === currentSessionId;
  }

  async function revokeSessions(targets: SessionRecord[]) {
    bulkBusy = true;
    sessionResult = null;
    const outcome = await runBulk(targets, async (session) => {
      const response = await trellis.authSessionsRevoke({
        expectedVersion: session.version,
        idempotencyKey: ulid(),
        reason: null,
        sessionId: session.sessionId,
      }).take();
      if (isErr(response)) throw new Error(errorMessage(response));
    });
    failedTargets = outcome.failed.map((failure) => failure.target);
    for (const session of targets) selectedSessions.delete(session.sessionId);
    sessionResult = {
      succeeded: outcome.succeeded,
      failed: outcome.failed.map((failure) => `${describeSessionPrincipal(failure.target).title}: ${failure.reason}`),
    };
    bulkBusy = false;
    void loadSessions();
  }

  async function requestBulkRevoke() {
    const targets = revocableSessions.filter((session) => selectedSessions.has(session.sessionId));
    if (targets.length === 0) return;
    const confirmed = await confirmationModal?.confirm({
      title: `Revoke ${targets.length} session${targets.length === 1 ? "" : "s"}?`,
      message: "Each session loses its credentials and active connections immediately.",
      confirmLabel: `Revoke ${targets.length}`,
      targetLabel: "Sessions",
      targetName: `${targets.length} sessions`,
      expectedValue: bulkExpectedCount(targets.length),
      details: bulkTargetDetails(targets.map((target) => describeSessionPrincipal(target).title)),
    });
    if (!confirmed) return;
    await revokeSessions(targets);
  }

  async function kickConnections(targets: ConnectionRecord[]) {
    bulkBusy = true;
    connectionResult = null;
    const outcome = await runBulk(targets, async (connection) => {
      const response = await trellis.authConnectionsKick({
        connectionId: connection.connectionId,
        idempotencyKey: ulid(),
        reason: null,
      }).take();
      if (isErr(response)) throw new Error(errorMessage(response));
    });
    for (const connection of targets) selectedConnections.delete(connection.connectionId);
    connectionResult = {
      succeeded: outcome.succeeded,
      failed: outcome.failed.map((failure) => `${describeSessionPrincipal(failure.target).title}: ${failure.reason}`),
    };
    bulkBusy = false;
    void loadConnections();
  }

  async function requestBulkKick() {
    const targets = connections.filter((connection) => selectedConnections.has(connection.connectionId));
    if (targets.length === 0) return;
    const confirmed = await confirmationModal?.confirm({
      title: `Disconnect ${targets.length} connection${targets.length === 1 ? "" : "s"}?`,
      message: "Each live NATS connection is dropped. Sessions stay valid until they reconnect.",
      confirmLabel: `Disconnect ${targets.length}`,
      targetLabel: "Connections",
      targetName: `${targets.length} connections`,
      expectedValue: bulkExpectedCount(targets.length),
      details: bulkTargetDetails(targets.map((target) => describeSessionPrincipal(target).title)),
    });
    if (!confirmed) return;
    await kickConnections(targets);
  }

  onMount(() => { loadActive(); });
</script>

<section class="space-y-4">
  <PageToolbar title="Sessions" description="Inspect active sessions and connections and disconnect compromised principals.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={loadActive} disabled={loading}>Refresh</button>
      <ActionMenu buttonBaseClass="btn btn-outline btn-sm" menuClass="z-10" widthClass="w-56">
        {#snippet summary()}
          Actions <Icon name="chevronDown" size={14} />
        {/snippet}
        <li><a href={resolve("/admin/sessions/revoke")}>Revoke a session</a></li>
        <li><a href={resolve("/admin/sessions/kick")}>Kick a connection</a></li>
      </ActionMenu>
    {/snippet}
  </PageToolbar>

  <div class="flex items-center justify-between">
    <div role="tablist" class="tabs tabs-bordered">
      <button
        role="tab"
        class={["tab", activeTab === "sessions" && "tab-active"]}
        onclick={() => { activeTab = "sessions"; void loadSessions(); }}
      >Sessions</button>
      <button
        role="tab"
        class={["tab", activeTab === "connections" && "tab-active"]}
        onclick={() => { activeTab = "connections"; void loadConnections(); }}
      >Connections</button>
    </div>
  </div>

  {#if error}
    <Notice variant="error">{error}</Notice>
  {/if}

  {#if activeTab === "sessions"}
    <form class="flex gap-2 items-end" onsubmit={(e) => { e.preventDefault(); void loadSessions(); }}>
      <input class="input input-bordered input-sm w-60" placeholder="Filter by principal…" bind:value={sessionFilterUser} />
      <button type="submit" class="btn btn-outline btn-sm" disabled={loading}>Apply</button>
      {#if sessionFilterUser.trim()}
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => { sessionFilterUser = ""; void loadSessions(); }}>Clear</button>
      {/if}
    </form>

    {#if loading}
      <Panel><LoadingState label="Loading sessions" /></Panel>
    {:else if sessions.length === 0}
      <EmptyState title="No sessions" description="No sessions match the current filter." />
    {:else}
      <Panel title="Sessions" eyebrow="Primary table">
        {#if sessionResult}
          <BulkResult
            succeeded={sessionResult.succeeded}
            failed={sessionResult.failed}
            pastTense="sessions revoked"
            onRetry={failedTargets.length > 0 ? () => void revokeSessions(failedTargets) : undefined}
            onDismiss={() => { sessionResult = null; }}
          />
        {:else if selectedSessions.size > 0}
          <BulkActionBar count={selectedSessions.size} noun="session" onClear={() => selectedSessions.clear()}>
            {#snippet actions()}
              <button class="btn btn-error btn-outline btn-sm" disabled={bulkBusy} onclick={() => void requestBulkRevoke()}>
                {bulkBusy ? "Revoking…" : "Revoke selected"}
              </button>
            {/snippet}
          </BulkActionBar>
        {/if}
        <DataTable fixed tableClass="w-full">
          <colgroup>
            <col class="w-10" />
            <col class="w-[40%]" />
            <col class="w-28" />
            <col class="w-36" />
            <col class="w-52" />
            <col class="w-28" />
          </colgroup>
          <thead>
            <tr>
              <th>
                <span class="sr-only">Select all sessions</span>
                <input
                  type="checkbox"
                  class="checkbox checkbox-xs"
                  aria-label="Select all sessions"
                  disabled={bulkBusy || selectableSessionIds.length === 0}
                  checked={selectableSessionIds.length > 0 && selectableSessionIds.every((id) => selectedSessions.has(id))}
                  indeterminate={selectableSessionIds.some((id) => selectedSessions.has(id)) && !selectableSessionIds.every((id) => selectedSessions.has(id))}
                  onchange={() => toggleAll(selectedSessions, selectableSessionIds)}
                />
              </th>
              <th>Principal</th>
              <th>Kind</th>
              <th><Term term="session key" /></th>
              <th>Activity</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each sessions as session (session.sessionId)}
              {@const summary = describeSessionPrincipal(session)}
              <tr>
                <td>
                  {#if !isCurrentSession(session)}
                    <input
                      type="checkbox"
                      class="checkbox checkbox-xs"
                      aria-label={`Select {summary.title}`}
                      disabled={bulkBusy}
                      checked={selectedSessions.has(session.sessionId)}
                      onchange={() => toggleId(selectedSessions, session.sessionId)}
                    />
                  {/if}
                </td>
                <td class="min-w-0">
                  <div class="truncate font-medium" title={summary.title}>{summary.title}</div>
                  {#if summary.details}
                    <div class="truncate text-xs text-base-content/60" title={summary.details}>{summary.details}</div>
                  {/if}
                </td>
                <td>
                  <span class={["badge badge-sm", participantKindBadgeClass(session.participantKind)]}>
                    {participantKindLabel(session.participantKind)}
                  </span>
                </td>
                <td class="trellis-identifier text-base-content/60">{formatShortKey(session.sessionKeyId)}</td>
                <td class="text-xs text-base-content/60">
                  <div>Last auth {formatDate(session.lastSeenAt)}</div>
                  <div>Created {formatDate(session.createdAt)}</div>
                </td>
                <td class="text-right">
                  <div class="flex items-center justify-end gap-2">
                    {#if isCurrentSession(session)}
                      <span class="badge badge-info badge-sm">Current</span>
                    {/if}
                    <ActionMenu menuClass="z-10" widthClass="w-48">
                      <li><a class="text-error" href={resolve(`/admin/sessions/revoke?sessionKey=${encodeURIComponent(session.sessionId)}`)}>Revoke</a></li>
                    </ActionMenu>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </DataTable>
      <p class="text-xs text-base-content/50">{sessions.length} session{sessions.length !== 1 ? "s" : ""}</p>
      </Panel>
    {/if}

  {:else}
    <form class="flex gap-2 items-end" onsubmit={(e) => { e.preventDefault(); void loadConnections(); }}>
      <input class="input input-bordered input-sm w-48" placeholder="Filter by principal…" bind:value={connFilterUser} />
      <input class="input input-bordered input-sm w-48" placeholder="Filter by session key…" bind:value={connFilterSessionKey} />
      <button type="submit" class="btn btn-outline btn-sm" disabled={loading}>Apply</button>
      {#if connFilterUser.trim() || connFilterSessionKey.trim()}
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => { connFilterUser = ""; connFilterSessionKey = ""; void loadConnections(); }}>Clear</button>
      {/if}
    </form>

    {#if loading}
      <Panel><LoadingState label="Loading connections" /></Panel>
    {:else if connections.length === 0}
      <EmptyState title="No connections" description="No active connections match the current filter." />
    {:else}
      <Panel title="Connections" eyebrow="Primary table">
        {#if connectionResult}
          <BulkResult
            succeeded={connectionResult.succeeded}
            failed={connectionResult.failed}
            pastTense="connections disconnected"
            onDismiss={() => { connectionResult = null; }}
          />
        {:else if selectedConnections.size > 0}
          <BulkActionBar count={selectedConnections.size} noun="connection" onClear={() => selectedConnections.clear()}>
            {#snippet actions()}
              <button class="btn btn-error btn-outline btn-sm" disabled={bulkBusy} onclick={() => void requestBulkKick()}>
                {bulkBusy ? "Disconnecting…" : "Disconnect selected"}
              </button>
            {/snippet}
          </BulkActionBar>
        {/if}
      <DataTable>
          <thead>
            <tr>
              <th>
                <span class="sr-only">Select all connections</span>
                <input
                  type="checkbox"
                  class="checkbox checkbox-xs"
                  aria-label="Select all connections"
                  disabled={bulkBusy || selectableConnectionIds.length === 0}
                  checked={selectableConnectionIds.length > 0 && selectableConnectionIds.every((id) => selectedConnections.has(id))}
                  indeterminate={selectableConnectionIds.some((id) => selectedConnections.has(id)) && !selectableConnectionIds.every((id) => selectedConnections.has(id))}
                  onchange={() => toggleAll(selectedConnections, selectableConnectionIds)}
                />
              </th>
              <th>Principal</th>
              <th>Kind</th>
              <th>Session Key</th>
              <th>User NKey</th>
              <th>Server</th>
              <th>Connected</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each connections as connection (connection.connectionId)}
              {@const summary = describeSessionPrincipal(connection)}
              <tr>
                <td>
                  <input
                    type="checkbox"
                    class="checkbox checkbox-xs"
                    aria-label={`Select {summary.title}`}
                    disabled={bulkBusy}
                    checked={selectedConnections.has(connection.connectionId)}
                    onchange={() => toggleId(selectedConnections, connection.connectionId)}
                  />
                </td>
                <td>
                  <div class="font-medium">{summary.title}</div>
                  {#if summary.details}
                    <div class="text-xs text-base-content/60">{summary.details}</div>
                  {/if}
                </td>
                <td>
                  <span class="badge badge-sm">Connection</span>
                </td>
                <td class="trellis-identifier text-base-content/60">{formatShortKey(connection.sessionId)}</td>
                <td class="trellis-identifier text-base-content/60">{formatShortKey(connection.userNkey)}</td>
                <td>
                  <span class="text-sm">{connection.serverId}</span>
                  <span class="text-xs text-base-content/50 block">client {connection.clientId}</span>
                </td>
                <td class="text-base-content/60">{formatDate(connection.connectedAt)}</td>
                <td class="text-right">
                  <ActionMenu menuClass="z-10" widthClass="w-48">
                      <li><a class="text-error" href={resolve(`/admin/sessions/kick?userNkey=${encodeURIComponent(connection.connectionId)}`)}>Kick</a></li>
                  </ActionMenu>
                </td>
              </tr>
            {/each}
          </tbody>
      </DataTable>
      <p class="text-xs text-base-content/50">{connections.length} connection{connections.length !== 1 ? "s" : ""}</p>
      </Panel>
    {/if}
  {/if}
</section>

<ConfirmationModal bind:this={confirmationModal} />
