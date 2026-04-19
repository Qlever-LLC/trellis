<script lang="ts">
  import type { AuthKickConnectionInput, AuthRevokeSessionInput } from "@qlever-llc/trellis-sdk/auth";
  import { onMount } from "svelte";
  import {
    describeSessionPrincipal,
    formatShortKey,
    participantKindBadgeClass,
    participantKindLabel,
    type ConnectionRecord,
    type SessionRecord,
  } from "../../../../lib/auth_display.ts";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { getNotifications } from "../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../lib/trellis";

  const trellisPromise = getTrellis();
  const notifications = getNotifications();

  type SessionListResponse = { sessions: SessionRecord[] };
  type ConnectionListResponse = { connections: ConnectionRecord[] };

  let activeTab = $state<"sessions" | "connections">("sessions");
  let loading = $state(true);
  let error = $state<string | null>(null);

  let sessions = $state<SessionRecord[]>([]);
  let sessionFilterUser = $state("");
  let revokeTarget = $state<string | null>(null);

  let connections = $state<ConnectionRecord[]>([]);
  let connFilterUser = $state("");
  let connFilterSessionKey = $state("");
  let kickTarget = $state<string | null>(null);

  async function loadSessions() {
    loading = true;
    error = null;
    try {
      const trellis = await trellisPromise;
      const response = await trellis.request<SessionListResponse>("Auth.ListSessions" as string, {
        user: sessionFilterUser.trim() || undefined
      }).orThrow();
      sessions = response.sessions ?? [];
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
      const trellis = await trellisPromise;
      const response = await trellis.request<ConnectionListResponse>("Auth.ListConnections" as string, {
        user: connFilterUser.trim() || undefined,
        sessionKey: connFilterSessionKey.trim() || undefined
      }).orThrow();
      connections = response.connections ?? [];
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

  async function revokeSession(session: SessionRecord) {
    const summary = describeSessionPrincipal(session);
    if (!window.confirm(`Revoke this ${participantKindLabel(session.participantKind).toLowerCase()} session? ${summary.title} will be disconnected.`)) return;
    revokeTarget = session.sessionKey;
    try {
      const trellis = await trellisPromise;
      await trellis.request<void>("Auth.RevokeSession" as string, { sessionKey: session.sessionKey } satisfies AuthRevokeSessionInput).orThrow();
      notifications.success(`Session revoked for ${summary.title}.`, "Revoked");
      await loadSessions();
    } catch (e) { error = errorMessage(e); }
    finally { revokeTarget = null; }
  }

  async function kickConnection(connection: ConnectionRecord) {
    const summary = describeSessionPrincipal(connection);
    if (!window.confirm(`Disconnect this ${participantKindLabel(connection.participantKind).toLowerCase()} connection for ${summary.title}?`)) return;
    kickTarget = connection.userNkey;
    try {
      const trellis = await trellisPromise;
      await trellis.request<void>("Auth.KickConnection" as string, { userNkey: connection.userNkey } satisfies AuthKickConnectionInput).orThrow();
      notifications.success(`Disconnected ${summary.title}.`, "Kicked");
      await loadConnections();
    } catch (e) { error = errorMessage(e); }
    finally { kickTarget = null; }
  }

  onMount(() => { void loadSessions(); });
</script>

<section class="space-y-4">
  <div class="flex items-center justify-between">
    <div role="tablist" class="tabs tabs-bordered">
      <button
        role="tab"
        class="tab"
        class:tab-active={activeTab === "sessions"}
        onclick={() => { activeTab = "sessions"; void loadSessions(); }}
      >Sessions</button>
      <button
        role="tab"
        class="tab"
        class:tab-active={activeTab === "connections"}
        onclick={() => { activeTab = "connections"; void loadConnections(); }}
      >Connections</button>
    </div>
    <button class="btn btn-ghost btn-sm" onclick={loadActive} disabled={loading}>Refresh</button>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if activeTab === "sessions"}
    <form class="flex gap-2 items-end" onsubmit={(e) => { e.preventDefault(); void loadSessions(); }}>
      <input class="input input-bordered input-sm w-60" placeholder="Filter by principal…" bind:value={sessionFilterUser} />
      <button type="submit" class="btn btn-primary btn-sm" disabled={loading}>Apply</button>
      {#if sessionFilterUser.trim()}
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => { sessionFilterUser = ""; void loadSessions(); }}>Clear</button>
      {/if}
    </form>

    {#if loading}
      <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
    {:else if sessions.length === 0}
      <p class="text-sm text-base-content/60">No sessions found.</p>
    {:else}
      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Principal</th>
              <th>Kind</th>
              <th>Session Key</th>
              <th>Activity</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each sessions as session (session.key)}
              {@const summary = describeSessionPrincipal(session)}
              <tr>
                <td>
                  <div class="font-medium">{summary.title}</div>
                  {#if summary.details}
                    <div class="text-xs text-base-content/60">{summary.details}</div>
                  {/if}
                </td>
                <td>
                  <span class={["badge badge-sm", participantKindBadgeClass(session.participantKind)]}>
                    {participantKindLabel(session.participantKind)}
                  </span>
                </td>
                <td class="font-mono text-xs text-base-content/60">{formatShortKey(session.sessionKey)}</td>
                <td class="text-xs text-base-content/60">
                  <div>Last auth {formatDate(session.lastAuth)}</div>
                  <div>Created {formatDate(session.createdAt)}</div>
                </td>
                <td class="text-right">
                  <button
                    class="btn btn-ghost btn-xs text-error"
                    onclick={() => revokeSession(session)}
                    disabled={revokeTarget === session.sessionKey}
                  >
                    {revokeTarget === session.sessionKey ? "Revoking…" : "Revoke"}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="text-xs text-base-content/50">{sessions.length} session{sessions.length !== 1 ? "s" : ""}</p>
    {/if}

  {:else}
    <form class="flex gap-2 items-end" onsubmit={(e) => { e.preventDefault(); void loadConnections(); }}>
      <input class="input input-bordered input-sm w-48" placeholder="Filter by principal…" bind:value={connFilterUser} />
      <input class="input input-bordered input-sm w-48" placeholder="Filter by session key…" bind:value={connFilterSessionKey} />
      <button type="submit" class="btn btn-primary btn-sm" disabled={loading}>Apply</button>
      {#if connFilterUser.trim() || connFilterSessionKey.trim()}
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => { connFilterUser = ""; connFilterSessionKey = ""; void loadConnections(); }}>Clear</button>
      {/if}
    </form>

    {#if loading}
      <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
    {:else if connections.length === 0}
      <p class="text-sm text-base-content/60">No connections found.</p>
    {:else}
      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr>
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
            {#each connections as connection (connection.key)}
              {@const summary = describeSessionPrincipal(connection)}
              <tr>
                <td>
                  <div class="font-medium">{summary.title}</div>
                  {#if summary.details}
                    <div class="text-xs text-base-content/60">{summary.details}</div>
                  {/if}
                </td>
                <td>
                  <span class={["badge badge-sm", participantKindBadgeClass(connection.participantKind)]}>
                    {participantKindLabel(connection.participantKind)}
                  </span>
                </td>
                <td class="font-mono text-xs text-base-content/60">{formatShortKey(connection.sessionKey)}</td>
                <td class="font-mono text-xs text-base-content/60">{formatShortKey(connection.userNkey)}</td>
                <td>
                  <span class="text-sm">{connection.serverId}</span>
                  <span class="text-xs text-base-content/50 block">client {connection.clientId}</span>
                </td>
                <td class="text-base-content/60">{formatDate(connection.connectedAt)}</td>
                <td class="text-right">
                  <button
                    class="btn btn-ghost btn-xs text-error"
                    onclick={() => kickConnection(connection)}
                    disabled={kickTarget === connection.userNkey}
                  >
                    {kickTarget === connection.userNkey ? "Kicking…" : "Kick"}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="text-xs text-base-content/50">{connections.length} connection{connections.length !== 1 ? "s" : ""}</p>
    {/if}
  {/if}
</section>
