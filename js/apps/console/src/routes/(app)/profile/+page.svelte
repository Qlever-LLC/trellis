<script lang="ts">
  import type { AuthMeOutput } from "@qlever-llc/trellis/sdk/auth";
  import { onMount } from "svelte";
  import { getInitials, getRoleLabel } from "../../../lib/control-panel.ts";
  import {
    describeUserGrant,
    participantKindBadgeClass,
    participantKindLabel,
    type ParticipantKind,
    type UserGrantRecord,
  } from "../../../lib/auth_display.ts";
  import { errorMessage, formatDate } from "../../../lib/format";
  import { getNotifications } from "../../../lib/notifications.svelte";
  import { getAuthenticatedUser, getConnection, getTrellis } from "../../../lib/trellis";

  const trellis = getTrellis();
  const connection = getConnection();
  const notifications = getNotifications();
  type ProfileRequester = {
    request(method: "Auth.ListUserGrants", input: Record<string, never>): { orThrow(): Promise<{ grants: UserGrantRecord[] }> };
    request(method: "Auth.RevokeUserGrant", input: RevokeUserGrantInput): { orThrow(): Promise<void> };
  };
  const profileSource: object = trellis;
  const profileRequester = profileSource as ProfileRequester;

  type RevokeUserGrantInput = { contractDigest: string };

  let loading = $state(true);
  let error = $state<string | null>(null);
  let user = $state<AuthMeOutput["user"] | null>(null);
  let participantKind = $state<ParticipantKind | null>(null);
  const connectionStatus = $derived(connection.status.phase);
  let grants = $state<UserGrantRecord[]>([]);
  let revokeTarget = $state<string | null>(null);

  async function loadProfile() {
    loading = true;
    error = null;
    try {
      const me = await getAuthenticatedUser(trellis);
      user = me.user ?? null;
      participantKind = me.participantKind;
      const grantsResponse = await profileRequester.request("Auth.ListUserGrants", {}).orThrow();
      grants = grantsResponse.grants ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function revokeGrant(grant: UserGrantRecord) {
    if (!window.confirm(`Revoke this ${participantKindLabel(grant.participantKind).toLowerCase()} grant? ${grant.displayName || grant.contractId} will lose access to act on your behalf.`)) return;
    revokeTarget = grant.contractDigest;
    try {
      await profileRequester.request("Auth.RevokeUserGrant", {
        contractDigest: grant.contractDigest,
      } satisfies RevokeUserGrantInput).orThrow();
      notifications.success(`${participantKindLabel(grant.participantKind)} grant revoked.`, "Revoked");
      await loadProfile();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      revokeTarget = null;
    }
  }

  onMount(() => {
    void loadProfile();
  });
</script>

{#if loading}
  <div class="flex justify-center py-12">
    <span class="loading loading-spinner loading-md"></span>
  </div>
{:else if error}
  <div class="alert alert-error mb-4"><span>{error}</span></div>
{:else if user}
  <section class="space-y-6">
    <div class="flex items-center gap-4">
      {#if user.image}
        <div class="avatar">
          <div class="w-12 rounded-full">
            <img src={user.image} alt={user.name} />
          </div>
        </div>
      {:else}
        <div class="avatar avatar-placeholder">
          <div class="bg-neutral text-neutral-content w-12 rounded-full">
            <span class="text-lg">{getInitials(user)}</span>
          </div>
        </div>
      {/if}
      <div>
        <h2 class="text-xl font-semibold">{user.name}</h2>
        <p class="text-sm text-base-content/60">{getRoleLabel(user)}</p>
      </div>
      <div class="ml-auto">
        <button class="btn btn-ghost btn-sm" onclick={loadProfile}>Refresh</button>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="card bg-base-100 border border-base-300">
        <div class="card-body p-4">
          <p class="text-xs uppercase font-semibold text-base-content/50">Origin</p>
          <p class="text-sm mt-1">{user.origin}</p>
        </div>
      </div>
      <div class="card bg-base-100 border border-base-300">
        <div class="card-body p-4">
          <p class="text-xs uppercase font-semibold text-base-content/50">Signed in as</p>
          {#if participantKind}
            <span class={["badge badge-sm mt-1", participantKindBadgeClass(participantKind)]}>
              {participantKindLabel(participantKind)}
            </span>
          {:else}
            <p class="text-sm mt-1">—</p>
          {/if}
        </div>
      </div>
      <div class="card bg-base-100 border border-base-300">
        <div class="card-body p-4">
          <p class="text-xs uppercase font-semibold text-base-content/50">Session</p>
          <p class="text-sm mt-1 flex items-center gap-2">
            <span class="inline-block w-2 h-2 rounded-full" class:bg-success={connectionStatus === "connected"} class:bg-warning={connectionStatus === "reconnecting"} class:bg-error={connectionStatus !== "connected" && connectionStatus !== "reconnecting"}></span>
            {connectionStatus === "connected" ? "Connected" : connectionStatus === "reconnecting" ? "Reconnecting" : "Disconnected"}
          </p>
        </div>
      </div>
    </div>

    {#if user.capabilities?.length}
      <div>
        <h3 class="text-sm font-semibold mb-2">Capabilities</h3>
        <div class="flex flex-wrap gap-2">
          {#each user.capabilities as cap (cap)}
            <span class="badge badge-outline badge-sm">{cap}</span>
          {/each}
        </div>
      </div>
    {/if}

    <div class="divider"></div>

    <div>
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-sm font-semibold">Delegated grants</h3>
          <p class="text-xs text-base-content/50 mt-1">Review the apps and agents that can act on your behalf and revoke access when needed.</p>
        </div>
      </div>

      {#if grants.length === 0}
        <p class="text-sm text-base-content/60">No delegated app or agent grants.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Grant</th>
                <th>Kind</th>
                <th>Contract</th>
                <th>Capabilities</th>
                <th>Granted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each grants as grant (grant.contractDigest)}
                {@const summary = describeUserGrant(grant)}
                <tr>
                  <td>
                    <div class="font-medium">{summary.title}</div>
                    <div class="text-xs text-base-content/60">{summary.details}</div>
                  </td>
                  <td>
                    <span class={["badge badge-sm", participantKindBadgeClass(grant.participantKind)]}>
                      {participantKindLabel(grant.participantKind)}
                    </span>
                  </td>
                  <td>
                    <div class="font-mono text-xs text-base-content/60">{grant.contractId}</div>
                    <div class="font-mono text-xs text-base-content/40">{grant.contractDigest.slice(0, 12)}…</div>
                  </td>
                  <td class="text-xs text-base-content/60">
                    {#if grant.capabilities.length}
                      <div class="flex flex-wrap gap-1">
                        {#each grant.capabilities as capability (capability)}
                          <span class="badge badge-outline badge-xs">{capability}</span>
                        {/each}
                      </div>
                    {:else}
                      —
                    {/if}
                  </td>
                  <td class="text-xs text-base-content/60">
                    <div>{formatDate(grant.grantedAt)}</div>
                    <div>Updated {formatDate(grant.updatedAt)}</div>
                  </td>
                  <td class="text-right">
                    <button
                      class="btn btn-ghost btn-xs text-error"
                      onclick={() => revokeGrant(grant)}
                      disabled={revokeTarget === grant.contractDigest}
                    >
                      {revokeTarget === grant.contractDigest ? "Revoking…" : "Revoke"}
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </section>
{/if}
