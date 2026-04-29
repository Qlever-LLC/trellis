<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import type { AuthListUsersOutput } from "@qlever-llc/trellis/sdk/auth";
  import type { SessionRecord } from "../../../../lib/auth_display.ts";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { getTrellis } from "../../../../lib/trellis";

  const trellis = getTrellis();

  type UserView = {
    origin: string;
    id: string;
    name?: string;
    email?: string;
    active: boolean;
    capabilities: string[];
  };

  function identityLabel(user: UserView) {
    return user.name ?? user.email ?? user.id;
  }

  function userKey(user: Pick<UserView, "origin" | "id">) {
    return `${user.origin}:${user.id}`;
  }

  let loading = $state(true);
  let error = $state<string | null>(null);
  let users = $state<UserView[]>([]);
  let userLastAuth = $state<Record<string, string>>({});

  async function load() {
    loading = true;
    error = null;
    try {
      const [usersResponse, sessionsResponse] = await Promise.all([
        trellis.request("Auth.ListUsers", {}).take(),
        trellis.request("Auth.ListSessions", {}).take(),
      ]);
      if (isErr(usersResponse)) { error = errorMessage(usersResponse); return; }
      if (isErr(sessionsResponse)) { error = errorMessage(sessionsResponse); return; }
      users = usersResponse.users ?? [];
      const lastAuthByUser: Record<string, string> = {};
      for (const session of sessionsResponse.sessions ?? []) {
        if (session.principal.type !== "user") continue;
        const key = userKey(session.principal);
        if (!lastAuthByUser[key] || session.lastAuth > lastAuthByUser[key]) {
          lastAuthByUser[key] = session.lastAuth;
        }
      }
      userLastAuth = lastAuthByUser;
    } catch (e) { error = errorMessage(e); }
    finally { loading = false; }
  }

  onMount(() => { void load(); });
</script>

<section class="space-y-4">
  <PageToolbar title="Users" description="Manage user activation and capabilities.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading users" /></Panel>
  {:else if users.length === 0}
    <EmptyState title="No users" description="No users have been registered yet." />
  {:else}
    <Panel title="Users" eyebrow="Primary table">
    <div class="overflow-x-auto">
      <table class="table table-sm trellis-table table-fixed min-w-[860px]">
        <thead>
          <tr>
            <th class="w-[28%] min-w-56">Identity</th>
            <th class="w-[22%] min-w-44">Email</th>
            <th class="w-[22%] min-w-52">Capabilities</th>
            <th class="w-36">Last auth</th>
            <th class="w-28">Status</th>
            <th class="w-24 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each users as user (`${user.origin}:${user.id}`)}
            <tr>
              <td class="min-w-56 max-w-0 align-top">
                <div class="min-w-0 space-y-1">
                  <div class="truncate font-medium" title={identityLabel(user)}>{identityLabel(user)}</div>
                  <div class="break-all trellis-identifier leading-snug text-base-content/60">
                    {userKey(user)}
                  </div>
                </div>
              </td>
              <td class="min-w-48 max-w-0 align-top text-base-content/60">
                {#if user.email}
                  <div class="truncate" title={user.email}>{user.email}</div>
                {:else}
                  <span>—</span>
                {/if}
              </td>
              <td class="min-w-56 align-top">
                <div class="flex min-w-0 flex-wrap gap-1">
                  {#each user.capabilities as cap (cap)}
                    <span class="badge badge-outline badge-xs max-w-full break-all whitespace-normal leading-tight">{cap}</span>
                  {/each}
                  {#if user.capabilities.length === 0}
                    <span class="text-xs text-base-content/40">None</span>
                  {/if}
                </div>
              </td>
              <td class="w-36 align-top text-xs text-base-content/60">
                {#if userLastAuth[userKey(user)]}
                  <span title={userLastAuth[userKey(user)]}>{formatDate(userLastAuth[userKey(user)])}</span>
                {:else}
                  <span>No active session</span>
                {/if}
              </td>
              <td class="w-28 align-top">
                {#if user.active}
                  <span class="badge badge-success badge-sm">Active</span>
                {:else}
                  <span class="badge badge-neutral badge-sm">Inactive</span>
                {/if}
              </td>
              <td class="w-24 whitespace-nowrap text-right align-top">
                <details class="dropdown dropdown-end">
                  <summary class="btn btn-ghost btn-xs">Actions</summary>
                  <ul class="menu dropdown-content z-10 mt-2 w-44 rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
                    <li><a href={resolve(`/admin/users/edit?user=${encodeURIComponent(user.id)}&origin=${encodeURIComponent(user.origin)}`)}>Edit</a></li>
                  </ul>
                </details>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-base-content/50">{users.length} user{users.length !== 1 ? "s" : ""}</p>
    </Panel>
  {/if}
</section>
