<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type { AuthListUsersOutput, AuthUpdateUserInput } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  type UserView = AuthListUsersOutput["users"][number];

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let targetUser = $state<UserView | null>(null);
  let capabilitiesText = $state("");
  let active = $state(true);
  let savePending = $state(false);

  const requestedUserId = $derived(page.url.searchParams.get("user") ?? "");
  const requestedOrigin = $derived(page.url.searchParams.get("origin") ?? "");
  const hasTargetParams = $derived(requestedUserId.length > 0 && requestedOrigin.length > 0);

  function parseCapabilities(value: string) {
    const values: string[] = [];
    for (const capability of value.split(",").map((entry) => entry.trim()).filter(Boolean)) {
      if (!values.includes(capability)) values.push(capability);
    }
    return values;
  }

  function loadUserIntoForm(user: UserView | null) {
    if (!user) return;
    capabilitiesText = user.capabilities.join(", ");
    active = user.active;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      targetUser = null;
      if (!hasTargetParams) return;

      const response = await trellis.request("Auth.ListUsers", {}).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      const users = response.users ?? [];
      const match = users.find((user) => user.id === requestedUserId && user.origin === requestedOrigin) ?? null;
      targetUser = match;
      loadUserIntoForm(match);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function saveUser() {
    if (!targetUser) return;
    savePending = true;
    error = null;
    try {
      const response = await trellis.request("Auth.UpdateUser", {
        origin: targetUser.origin,
        id: targetUser.id,
        active,
        capabilities: parseCapabilities(capabilitiesText),
      } satisfies AuthUpdateUserInput).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Updated ${targetUser.name ?? targetUser.id}.`, "Updated");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      savePending = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Edit user" description="Update activation and capabilities for a user.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/users")}>Back to users</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading users" /></Panel>
  {:else if !hasTargetParams}
    <EmptyState title="Choose a user" description="Open the Users table and choose Edit from the user's row actions.">
      {#snippet actions()}
        <a class="btn btn-outline btn-sm" href={resolve("/admin/users")}>Back to users</a>
      {/snippet}
    </EmptyState>
  {:else if !targetUser}
    <EmptyState title="User not found" description="The selected user no longer exists or the edit link is stale.">
      {#snippet actions()}
        <a class="btn btn-outline btn-sm" href={resolve("/admin/users")}>Back to users</a>
      {/snippet}
    </EmptyState>
  {:else}
    <Panel title="User settings" eyebrow="Workflow">
      <form class="trellis-form" onsubmit={(event) => { event.preventDefault(); void saveUser(); }}>
        <div class="trellis-record-summary">
          <div class="trellis-record-summary-title">{targetUser.name ?? targetUser.id}</div>
          <div class="trellis-metadata">{targetUser.email ?? "No email"}</div>
          <div class="trellis-identifier break-all">{targetUser.origin}:{targetUser.id}</div>
        </div>

        <label class="trellis-toggle-row">
          <span>
            <span class="block text-sm font-medium">Active</span>
            <span class="trellis-field-help">Controls whether this user can authenticate and use assigned capabilities.</span>
          </span>
          <input class="toggle toggle-sm" type="checkbox" bind:checked={active} />
        </label>

        <label class="trellis-field">
          <span class="trellis-field-label">Capabilities</span>
          <textarea class="textarea textarea-bordered textarea-sm font-mono" bind:value={capabilitiesText} placeholder="users.read, apps.manage"></textarea>
          <span class="trellis-field-help">Comma-separated capability names.</span>
        </label>

        <div class="trellis-action-row">
          <a class="btn btn-ghost btn-sm" href={resolve("/admin/users")}>Cancel</a>
          <button class="btn btn-primary btn-sm" type="submit" disabled={savePending}>{savePending ? "Saving..." : "Save user"}</button>
        </div>
      </form>
    </Panel>
  {/if}
</section>
