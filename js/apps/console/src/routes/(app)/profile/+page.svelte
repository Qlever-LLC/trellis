<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type { AuthMeOutput } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
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
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import InlineMetricsStrip from "$lib/components/InlineMetricsStrip.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { getAuthenticatedUser, getConnection, getTrellis } from "../../../lib/trellis";

  const trellis = getTrellis();
  const connection = getConnection();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let user = $state<AuthMeOutput["user"] | null>(null);
  let participantKind = $state<ParticipantKind | null>(null);
  const connectionStatus = $derived(connection.status.phase);
  let grants = $state<UserGrantRecord[]>([]);

  async function loadProfile() {
    loading = true;
    error = null;
    try {
      const me = await getAuthenticatedUser(trellis);
      user = me.user ?? null;
      participantKind = me.participantKind;
      const grantsResponse = await trellis.request("Auth.ListUserGrants", {}).take();
      if (isErr(grantsResponse)) { error = errorMessage(grantsResponse); return; }
      grants = grantsResponse.grants ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void loadProfile();
  });
</script>

{#if loading}
  <Panel><LoadingState label="Loading profile" /></Panel>
{:else if error}
  <div class="alert alert-error mb-4"><span>{error}</span></div>
{:else if user}
  <section class="space-y-4">
    <PageToolbar title="Profile" description="Review your principal, session state, capabilities, and delegated grants.">
      {#snippet actions()}
        <button class="btn btn-ghost btn-sm" onclick={loadProfile}>Refresh</button>
        <details class="dropdown dropdown-end">
          <summary class="btn btn-outline btn-sm">Actions <Icon name="chevronDown" size={14} /></summary>
          <ul class="menu dropdown-content z-10 mt-2 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
            <li><a href={resolve("/profile/grants/revoke")}>Revoke a delegated grant</a></li>
          </ul>
        </details>
      {/snippet}
    </PageToolbar>

    <Panel title={user.name} eyebrow="Signed-in principal">
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
    </div>
    </Panel>

    <InlineMetricsStrip metrics={[{ label: "Origin", value: user.origin }, { label: "Signed in as", value: participantKind ? participantKindLabel(participantKind) : "—" }, { label: "Session", value: connectionStatus === "connected" ? "Connected" : connectionStatus === "reconnecting" ? "Reconnecting" : "Disconnected" }]} />

    {#if user.capabilities?.length}
      <Panel title="Capabilities" eyebrow="User grants">
        <h3 class="text-sm font-semibold mb-2">Capabilities</h3>
        <div class="flex flex-wrap gap-2">
          {#each user.capabilities as cap (cap)}
            <span class="badge badge-outline badge-sm">{cap}</span>
          {/each}
        </div>
      </Panel>
    {/if}

    <Panel title="Delegated grants" eyebrow="Primary table">

      {#if grants.length === 0}
        <EmptyState title="No delegated grants" description="No apps or agents currently act on your behalf." />
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm trellis-table">
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
                    <details class="dropdown dropdown-end">
                      <summary class="btn btn-ghost btn-xs">Actions</summary>
                      <ul class="menu dropdown-content z-10 mt-2 w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
                        <li><a class="text-error" href={resolve(`/profile/grants/revoke?grant=${encodeURIComponent(grant.contractDigest)}`)}>Revoke</a></li>
                      </ul>
                    </details>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Panel>
  </section>
{/if}
