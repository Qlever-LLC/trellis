<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import { resolve } from "$app/paths";
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
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { getTrellis } from "../../../../lib/trellis";

  const trellis = getTrellis();

  let activeTab = $state<"sessions" | "connections">("sessions");
  let loading = $state(true);
  let error = $state<string | null>(null);

  let sessions = $state<SessionRecord[]>([]);
  let sessionFilterUser = $state("");

  let connections = $state<ConnectionRecord[]>([]);
  let connFilterUser = $state("");
  let connFilterSessionKey = $state("");

  async function loadSessions() {
    loading = true;
    error = null;
    try {
      const response = await trellis.request("Auth.ListSessions", {
        user: sessionFilterUser.trim() || undefined
      }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
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
      const response = await trellis.request("Auth.ListConnections", {
        user: connFilterUser.trim() || undefined,
        sessionKey: connFilterSessionKey.trim() || undefined
      }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
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

  onMount(() => { void loadSessions(); });
</script>

<section class="space-y-4">
  <PageToolbar title="Sessions" description="Inspect active sessions and connections and disconnect compromised principals.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={loadActive} disabled={loading}>Refresh</button>
      <details class="dropdown dropdown-end">
        <summary class="btn btn-outline btn-sm">Actions <Icon name="chevronDown" size={14} /></summary>
        <ul class="menu dropdown-content z-10 mt-2 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
          <li><a href={resolve("/admin/sessions/revoke")}>Revoke a session</a></li>
          <li><a href={resolve("/admin/sessions/kick")}>Kick a connection</a></li>
        </ul>
      </details>
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
    <div class="alert alert-error"><span>{error}</span></div>
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
      <div class="overflow-x-auto">
        <table class="table table-sm trellis-table">
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
                  <details class="dropdown dropdown-end">
                    <summary class="btn btn-ghost btn-xs">Actions</summary>
                    <ul class="menu dropdown-content z-10 mt-2 w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
                      <li><a class="text-error" href={resolve(`/admin/sessions/revoke?sessionKey=${encodeURIComponent(session.sessionKey)}`)}>Revoke</a></li>
                    </ul>
                  </details>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
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
      <div class="overflow-x-auto">
        <table class="table table-sm trellis-table">
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
                  <details class="dropdown dropdown-end">
                    <summary class="btn btn-ghost btn-xs">Actions</summary>
                    <ul class="menu dropdown-content z-10 mt-2 w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
                      <li><a class="text-error" href={resolve(`/admin/sessions/kick?userNkey=${encodeURIComponent(connection.userNkey)}`)}>Kick</a></li>
                    </ul>
                  </details>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="text-xs text-base-content/50">{connections.length} connection{connections.length !== 1 ? "s" : ""}</p>
      </Panel>
    {/if}
  {/if}
</section>
