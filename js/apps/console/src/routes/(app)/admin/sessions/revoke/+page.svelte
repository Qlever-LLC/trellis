<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type { AuthRevokeSessionInput } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { describeSessionPrincipal, formatShortKey, participantKindLabel, type SessionRecord } from "../../../../../lib/auth_display.ts";
  import { errorMessage, formatDate } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let pending = $state(false);
  let sessions = $state<SessionRecord[]>([]);
  let selectedSessionKey = $state("");

  const selectedSession = $derived(sessions.find((session) => session.sessionKey === selectedSessionKey) ?? null);

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await trellis.request("Auth.ListSessions", {}).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      sessions = response.sessions ?? [];
      const requestedSessionKey = page.url.searchParams.get("sessionKey");
      selectedSessionKey = requestedSessionKey && sessions.some((session) => session.sessionKey === requestedSessionKey) ? requestedSessionKey : (sessions[0]?.sessionKey ?? "");
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function revokeSession() {
    if (!selectedSession) return;
    const summary = describeSessionPrincipal(selectedSession);
    pending = true;
    error = null;
    try {
      const response = await trellis.request("Auth.RevokeSession", { sessionKey: selectedSession.sessionKey } satisfies AuthRevokeSessionInput).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Session revoked for ${summary.title}.`, "Revoked");
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
  <PageToolbar title="Revoke session" description="Confirm and revoke an active session.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/sessions")}>Back to sessions</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading sessions" /></Panel>
  {:else if sessions.length === 0}
    <EmptyState title="No sessions" description="No active sessions are available to revoke." />
  {:else}
    <Panel title="Confirm revoke" eyebrow="Workflow">
      <div class="space-y-4">
        <label class="form-control gap-1">
          <span class="label-text text-xs">Session</span>
          <select class="select select-bordered select-sm" bind:value={selectedSessionKey} required>
            {#each sessions as session (session.key)}
              {@const summary = describeSessionPrincipal(session)}
              <option value={session.sessionKey}>{summary.title} — {formatShortKey(session.sessionKey)}</option>
            {/each}
          </select>
        </label>

        {#if selectedSession}
          {@const summary = describeSessionPrincipal(selectedSession)}
          <div class="rounded-box border border-base-300 p-3 text-sm">
            <div class="font-medium">{summary.title}</div>
            <div class="text-base-content/60">{participantKindLabel(selectedSession.participantKind)}</div>
            <div class="font-mono text-xs text-base-content/60">{selectedSession.sessionKey}</div>
            <div class="text-xs text-base-content/60">Last auth {formatDate(selectedSession.lastAuth)}</div>
          </div>
        {/if}

        <div class="flex flex-wrap gap-2">
          <button class="btn btn-error btn-sm" onclick={revokeSession} disabled={!selectedSession || pending}>{pending ? "Revoking..." : "Revoke session"}</button>
          <a class="btn btn-ghost btn-sm" href={resolve("/admin/sessions")}>Cancel</a>
        </div>
      </div>
    </Panel>
  {/if}
</section>
