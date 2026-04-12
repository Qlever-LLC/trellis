<script lang="ts">
  import type { AuthKickConnectionInput, AuthListConnectionsOutput, AuthListSessionsOutput, AuthRevokeSessionInput } from "@qlever-llc/trellis/sdk/auth";
  import { onMount } from "svelte";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { type ConnectionRow, formatOriginId, parseConnectionRowKey, parseSessionRowKey, type SessionRow } from "../../../../lib/keys";
  import { getNotifications } from "../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../lib/trellis";

  const trellisPromise = getTrellis();
  const notifications = getNotifications();

  type SessionView = AuthListSessionsOutput["sessions"][number] & { parsed: SessionRow | null };
  type ConnectionView = AuthListConnectionsOutput["connections"][number] & { parsed: ConnectionRow | null };

  let activeTab = $state<"sessions" | "connections">("sessions");
  let loading = $state(true);
  let error = $state<string | null>(null);

  let sessions = $state<SessionView[]>([]);
  let sessionFilterUser = $state("");
  let revokeTarget = $state<string | null>(null);

  let connections = $state<ConnectionView[]>([]);
  let connFilterUser = $state("");
  let connFilterSessionKey = $state("");
  let kickTarget = $state<string | null>(null);

  async function loadSessions() {
    loading = true;
    error = null;
    try {
      const trellis = await trellisPromise;
      const response = await trellis.requestOrThrow("Auth.ListSessions", {
        user: sessionFilterUser.trim() || undefined
      });
      sessions = (response.sessions ?? []).map((s) => ({
        ...s,
        parsed: parseSessionRowKey(s.key)
      }));
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
      const response = await trellis.requestOrThrow("Auth.ListConnections", {
        user: connFilterUser.trim() || undefined,
        sessionKey: connFilterSessionKey.trim() || undefined
      });
      connections = (response.connections ?? []).map((c) => ({
        ...c,
        parsed: parseConnectionRowKey(c.key)
      }));
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

  async function revokeSession(sessionKey: string, principal: string) {
    if (!window.confirm(`Revoke this session? ${principal} will be disconnected.`)) return;
    revokeTarget = sessionKey;
    try {
      const trellis = await trellisPromise;
      await trellis.requestOrThrow("Auth.RevokeSession", { sessionKey } satisfies AuthRevokeSessionInput);
      notifications.success(`Session revoked for ${principal}.`, "Revoked");
      await loadSessions();
    } catch (e) { error = errorMessage(e); }
    finally { revokeTarget = null; }
  }

  async function kickConnection(userNkey: string, principal: string) {
    if (!window.confirm(`Disconnect ${principal}?`)) return;
    kickTarget = userNkey;
    try {
      const trellis = await trellisPromise;
      await trellis.requestOrThrow("Auth.KickConnection", { userNkey } satisfies AuthKickConnectionInput);
      notifications.success(`Disconnected ${principal}.`, "Kicked");
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
              <th>Type</th>
              <th>Session Key</th>
              <th>Connected</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each sessions as session (session.key)}
              <tr>
                <td class="font-medium">{session.parsed ? formatOriginId(session.parsed.origin, session.parsed.id) : session.key}</td>
                <td>
                  <span class="badge badge-sm" class:badge-info={session.type !== "service"} class:badge-ghost={session.type === "service"}>
                    {session.type === "service" ? "Service" : "User"}
                  </span>
                </td>
                <td class="font-mono text-xs text-base-content/60">{session.parsed?.sessionKey?.slice(0, 12) ?? "—"}…</td>
                <td class="text-base-content/60">{formatDate(session.createdAt)}</td>
                <td class="text-right">
                  {#if session.parsed?.sessionKey}
                    <button
                      class="btn btn-ghost btn-xs text-error"
                      onclick={() => revokeSession(session.parsed.sessionKey, formatOriginId(session.parsed.origin, session.parsed.id))}
                      disabled={revokeTarget === session.parsed.sessionKey}
                    >
                      {revokeTarget === session.parsed.sessionKey ? "Revoking…" : "Revoke"}
                    </button>
                  {/if}
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
              <th>Session Key</th>
              <th>User NKey</th>
              <th>Server</th>
              <th>Connected</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each connections as connection (connection.key)}
              <tr>
                <td class="font-medium">{connection.parsed ? formatOriginId(connection.parsed.origin, connection.parsed.id) : connection.key}</td>
                <td class="font-mono text-xs text-base-content/60">{connection.parsed?.sessionKey?.slice(0, 12) ?? "—"}…</td>
                <td class="font-mono text-xs text-base-content/60">{connection.parsed?.userNkey?.slice(0, 12) ?? "—"}…</td>
                <td>
                  <span class="text-sm">{connection.serverId}</span>
                  <span class="text-xs text-base-content/50 block">client {connection.clientId}</span>
                </td>
                <td class="text-base-content/60">{formatDate(connection.connectedAt)}</td>
                <td class="text-right">
                  {#if connection.parsed}
                    <button
                      class="btn btn-ghost btn-xs text-error"
                      onclick={() => kickConnection(connection.parsed.userNkey, formatOriginId(connection.parsed.origin, connection.parsed.id))}
                      disabled={kickTarget === connection.parsed.userNkey}
                    >
                      {kickTarget === connection.parsed.userNkey ? "Kicking…" : "Kick"}
                    </button>
                  {/if}
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
