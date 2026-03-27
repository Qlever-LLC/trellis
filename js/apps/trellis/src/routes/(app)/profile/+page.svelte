<script lang="ts">
  import type { AuthMeOutput } from "@qlever-llc/trellis-sdk-auth";
  import { getNatsState, getTrellisFor } from "@qlever-llc/trellis-svelte";
  import { onMount } from "svelte";
  import { trellisApp } from "../../../contracts/trellis_app.ts";
  import { getInitials, getRoleLabel } from "../../../lib/control-panel.ts";
  import { errorMessage, formatDate } from "../../../lib/format";
  import { getNotifications } from "../../../lib/notifications.svelte";

  const trellisPromise = getTrellisFor(trellisApp);
  const natsStatePromise = getNatsState();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let user = $state<AuthMeOutput["user"] | null>(null);
  let connectionStatus = $state("connecting");
  let approvals = $state<any[]>([]);
  let revokeTarget = $state<string | null>(null);

  async function loadProfile() {
    loading = true;
    error = null;
    try {
      const me = await (await trellisPromise).requestOrThrow("Auth.Me", {});
      user = me.user ?? null;
      const appResponse = await (await trellisPromise).requestOrThrow("Auth.ListApprovals", {});
      approvals = appResponse.approvals ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function revokeApproval(contractDigest: string) {
    if (!window.confirm("Revoke this app approval? The app will lose access to act on your behalf.")) return;
    revokeTarget = contractDigest;
    try {
      await (await trellisPromise).requestOrThrow("Auth.RevokeApproval", { contractDigest });
      notifications.success("App approval revoked.", "Revoked");
      await loadProfile();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      revokeTarget = null;
    }
  }

  onMount(() => {
    let active = true;
    let statusInterval: number | null = null;

    void (async () => {
      const natsState = await natsStatePromise;
      if (!active) return;
      connectionStatus = natsState.status;
      statusInterval = window.setInterval(() => {
        connectionStatus = natsState.status;
      }, 1000);
    })();

    void loadProfile();

    return () => {
      active = false;
      if (statusInterval !== null) window.clearInterval(statusInterval);
    };
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

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="card bg-base-100 border border-base-300">
        <div class="card-body p-4">
          <p class="text-xs uppercase font-semibold text-base-content/50">Origin</p>
          <p class="text-sm mt-1">{user.origin}</p>
        </div>
      </div>
      <div class="card bg-base-100 border border-base-300">
        <div class="card-body p-4">
          <p class="text-xs uppercase font-semibold text-base-content/50">Session</p>
          <p class="text-sm mt-1 flex items-center gap-2">
            <span class="inline-block w-2 h-2 rounded-full" class:bg-success={connectionStatus === "connected"} class:bg-warning={connectionStatus === "connecting"} class:bg-error={connectionStatus !== "connected" && connectionStatus !== "connecting"}></span>
            {connectionStatus === "connected" ? "Connected" : connectionStatus === "connecting" ? "Connecting" : "Disconnected"}
          </p>
        </div>
      </div>
    </div>

    {#if user.capabilities?.length}
      <div>
        <h3 class="text-sm font-semibold mb-2">Capabilities</h3>
        <div class="flex flex-wrap gap-2">
          {#each user.capabilities as cap}
            <span class="badge badge-outline badge-sm">{cap}</span>
          {/each}
        </div>
      </div>
    {/if}

    <div class="divider"></div>

    <div>
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold">Approved Apps</h3>
      </div>

      {#if approvals.length === 0}
        <p class="text-sm text-base-content/60">No app approvals.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>App</th>
                <th>Contract</th>
                <th>Approved</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each approvals as entry}
                <tr>
                  <td class="font-medium">{entry.approval.displayName ?? entry.approval.contractId ?? "—"}</td>
                  <td class="font-mono text-xs text-base-content/60">{entry.approval.contractDigest?.slice(0, 12)}…</td>
                  <td class="text-base-content/60">{formatDate(entry.answeredAt)}</td>
                  <td class="text-right">
                    <button
                      class="btn btn-ghost btn-xs text-error"
                      onclick={() => revokeApproval(entry.approval.contractDigest)}
                      disabled={revokeTarget === entry.approval.contractDigest}
                    >
                      {revokeTarget === entry.approval.contractDigest ? "Revoking…" : "Revoke"}
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
