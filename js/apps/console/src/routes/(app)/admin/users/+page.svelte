<script lang="ts">
  import { onMount } from "svelte";
  import type { AuthListUsersOutput, AuthUpdateUserInput } from "@qlever-llc/trellis/sdk/auth";
  import { errorMessage } from "../../../../lib/format";
  import { getNotifications } from "../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../lib/trellis";

  const trellis = getTrellis();
  const notifications = getNotifications();
  type UsersRequester = {
    request(method: "Auth.ListUsers", input: Record<string, never>): { orThrow(): Promise<AuthListUsersOutput> };
    request(method: "Auth.UpdateUser", input: AuthUpdateUserInput): { orThrow(): Promise<void> };
  };
  const usersSource: object = trellis;
  const usersRequester = usersSource as UsersRequester;

  type UserView = {
    origin: string;
    id: string;
    name?: string;
    email?: string;
    active: boolean;
    capabilities: string[];
  };

  let loading = $state(true);
  let error = $state<string | null>(null);
  let users = $state<UserView[]>([]);
  let editTarget = $state<UserView | null>(null);
  let editCaps = $state("");
  let savePending = $state(false);

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await usersRequester.request("Auth.ListUsers", {}).orThrow();
      users = res.users ?? [];
    } catch (e) { error = errorMessage(e); }
    finally { loading = false; }
  }

  function startEdit(user: UserView) {
    editTarget = user;
    editCaps = user.capabilities.join(", ");
  }

  function cancelEdit() {
    editTarget = null;
    editCaps = "";
  }

  async function toggleActive(user: UserView) {
    try {
      await usersRequester.request("Auth.UpdateUser", {
        origin: user.origin,
        id: user.id,
        active: !user.active,
      } satisfies AuthUpdateUserInput).orThrow();
      notifications.success(`${user.name ?? user.id} ${user.active ? "deactivated" : "activated"}.`, "Updated");
      await load();
    } catch (e) { error = errorMessage(e); }
  }

  async function saveCapabilities() {
    if (!editTarget) return;
    savePending = true;
    try {
      const capabilities = editCaps.split(",").map((c) => c.trim()).filter(Boolean);
      await usersRequester.request("Auth.UpdateUser", {
        origin: editTarget.origin,
        id: editTarget.id,
        capabilities,
      } satisfies AuthUpdateUserInput).orThrow();
      notifications.success(`Capabilities updated for ${editTarget.name ?? editTarget.id}.`, "Updated");
      cancelEdit();
      await load();
    } catch (e) { error = errorMessage(e); }
    finally { savePending = false; }
  }

  onMount(() => { void load(); });
</script>

<section class="space-y-4">
  <div class="flex items-center justify-end">
    <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
  {:else if users.length === 0}
    <p class="text-sm text-base-content/60">No users found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Name</th>
            <th>Origin</th>
            <th>ID</th>
            <th>Email</th>
            <th>Capabilities</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each users as user (`${user.origin}:${user.id}`)}
            <tr>
              <td class="font-medium">{user.name ?? "—"}</td>
              <td class="text-base-content/60">{user.origin}</td>
              <td class="font-mono text-xs text-base-content/60">{user.id}</td>
              <td class="text-base-content/60">{user.email ?? "—"}</td>
              <td>
                {#if editTarget?.origin === user.origin && editTarget?.id === user.id}
                  <form class="flex gap-1 items-center" onsubmit={(e) => { e.preventDefault(); void saveCapabilities(); }}>
                    <input class="input input-bordered input-xs w-40 font-mono" bind:value={editCaps} />
                    <button type="submit" class="btn btn-primary btn-xs" disabled={savePending}>Save</button>
                    <button type="button" class="btn btn-ghost btn-xs" onclick={cancelEdit}>Cancel</button>
                  </form>
                {:else}
                  <div class="flex flex-wrap gap-1">
                    {#each user.capabilities as cap (cap)}
                      <span class="badge badge-outline badge-xs">{cap}</span>
                    {/each}
                    {#if user.capabilities.length === 0}
                      <span class="text-xs text-base-content/40">None</span>
                    {/if}
                    <button class="btn btn-ghost btn-xs text-base-content/40" onclick={() => startEdit(user)}>Edit</button>
                  </div>
                {/if}
              </td>
              <td>
                {#if user.active}
                  <span class="badge badge-success badge-sm">Active</span>
                {:else}
                  <span class="badge badge-ghost badge-sm">Inactive</span>
                {/if}
              </td>
              <td class="text-right">
                <button
                  class="btn btn-ghost btn-xs"
                  onclick={() => toggleActive(user)}
                >
                  {user.active ? "Deactivate" : "Activate"}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-base-content/50">{users.length} user{users.length !== 1 ? "s" : ""}</p>
  {/if}
</section>
