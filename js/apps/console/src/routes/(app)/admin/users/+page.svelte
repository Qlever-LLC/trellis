<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { getTrellis } from "../../../../lib/trellis";

  const trellis = getTrellis();

  type UserView = {
    origin: string;
    id: string;
    name?: string;
    email?: string;
    active: boolean;
  };

  function identityLabel(user: UserView) {
    return user.name ?? user.email ?? user.id;
  }

  function userKey(user: Pick<UserView, "origin" | "id">) {
    return `${user.origin}:${user.id}`;
  }

  let loading = $state(true);
  let error = $state<string | null>(null);
  let sessionsWarning = $state<string | null>(null);
  let users = $state<UserView[]>([]);
  let userLastAuth = $state<Record<string, string>>({});

  const activeUserCount = $derived(users.filter((user) => user.active).length);
  const inactiveUserCount = $derived(users.length - activeUserCount);

  async function load() {
    loading = true;
    error = null;
    sessionsWarning = null;
    try {
      const usersResponse = await trellis.request("Auth.Users.List", { limit: 500, offset: 0 }).take();
      if (isErr(usersResponse)) { error = errorMessage(usersResponse); return; }
      users = usersResponse.users ?? [];

      const sessionsResponse = await trellis.request("Auth.Sessions.List", { limit: 500, offset: 0 }).take();
      if (isErr(sessionsResponse)) {
        sessionsWarning = `Last-auth metadata unavailable: ${errorMessage(sessionsResponse)}`;
        userLastAuth = {};
        return;
      }

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
  {#if sessionsWarning}
    <div class="alert alert-info"><span>{sessionsWarning}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading users" /></Panel>
  {:else if users.length === 0}
    <EmptyState title="No users" description="No users have been registered yet." />
  {:else}
    <div class="space-y-2 overflow-visible">
      <div class="flex flex-col gap-3 border-y border-base-300 bg-base-100/45 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div class="min-w-0">
          <p class="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-base-content/45">User registry</p>
          <p class="mt-1 text-sm text-base-content/60">Activation state and last-auth metadata.</p>
        </div>
        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <span class="badge badge-success badge-sm">{activeUserCount} active</span>
          {#if inactiveUserCount > 0}
            <span class="badge badge-neutral badge-sm">{inactiveUserCount} inactive</span>
          {/if}
        </div>
      </div>

      <table class="table table-sm trellis-table users-table border-b border-base-300 bg-base-100/30">
        <thead>
          <tr>
            <th class="w-[42%]">Identity</th>
            <th class="hidden w-[28%] md:table-cell">Email</th>
            <th class="hidden w-36 sm:table-cell">Last auth</th>
            <th class="w-28">Status</th>
            <th class="w-24 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each users as user (`${user.origin}:${user.id}`)}
            <tr class={["users-row", !user.active && "users-row-inactive"]}>
              <td class="max-w-0 align-top">
                <div class="flex min-w-0 items-start gap-3">
                  <span class={["mt-1.5 size-2 rounded-full", user.active ? "bg-success" : "bg-base-content/25"]} aria-hidden="true"></span>
                  <div class="min-w-0 space-y-1">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="truncate font-medium" title={identityLabel(user)}>{identityLabel(user)}</span>
                      <span class="badge badge-ghost badge-xs shrink-0">{user.origin}</span>
                    </div>
                    <div class="break-all trellis-identifier leading-snug text-base-content/60">
                      {userKey(user)}
                    </div>
                  </div>
                </div>
              </td>
              <td class="hidden max-w-0 align-top text-base-content/60 md:table-cell">
                {#if user.email}
                  <div class="truncate" title={user.email}>{user.email}</div>
                {:else}
                  <span>—</span>
                {/if}
              </td>
              <td class="hidden w-36 align-top text-xs text-base-content/60 sm:table-cell">
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
                  <ul class="menu dropdown-content z-30 mt-2 w-44 rounded-box border border-base-300 bg-base-100 p-2">
                    <li><a href={resolve(`/admin/users/edit?user=${encodeURIComponent(user.id)}&origin=${encodeURIComponent(user.origin)}`)}>Edit</a></li>
                  </ul>
                </details>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="text-xs text-base-content/50">{users.length} user{users.length !== 1 ? "s" : ""}</p>
    </div>
  {/if}
</section>

<style>
  .users-table {
    min-width: 0;
    table-layout: fixed;
    width: 100%;
  }

  .users-table thead {
    background-color: color-mix(
      in oklab,
      var(--color-base-content) 3.5%,
      transparent
    );
  }

  .users-row {
    transition: background-color 160ms ease-out;
  }

  .users-row-inactive {
    background-color: color-mix(
      in oklab,
      var(--color-base-content) 2.5%,
      transparent
    );
  }

</style>
