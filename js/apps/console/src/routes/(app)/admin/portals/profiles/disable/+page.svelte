<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthDisablePortalProfileInput,
    AuthListPortalProfilesOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { errorMessage } from "../../../../../../lib/format";
  import { getNotifications } from "../../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../../lib/trellis";

  type PortalProfile = AuthListPortalProfilesOutput["profiles"][number];

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let pending = $state(false);
  let error = $state<string | null>(null);
  let feedback = $state<string | null>(null);
  let profiles = $state<PortalProfile[]>([]);
  let portalId = $state(page.url.searchParams.get("portal") ?? "");

  const selectedProfile = $derived(portalId ? profiles.find((profile) => profile.portalId === portalId) ?? null : null);

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await trellis.request("Auth.ListPortalProfiles", {}).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      profiles = response.profiles ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function disableProfile() {
    if (!selectedProfile || selectedProfile.disabled) return;

    pending = true;
    error = null;
    feedback = null;
    try {
      const response = await trellis.request("Auth.DisablePortalProfile", {
        portalId: selectedProfile.portalId,
      } satisfies AuthDisablePortalProfileInput).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      feedback = `Portal profile ${selectedProfile.portalId} disabled.`;
      notifications.success(feedback, "Disabled");
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
  <PageToolbar title="Disable portal profile" description="Disable a portal profile after confirming the selected profile.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals")}>Back to portals</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if feedback}
    <div class="alert alert-success"><span>{feedback}</span></div>
  {/if}

  <Panel title="Confirm disable" eyebrow="Portal profile">
    {#if loading}
      <LoadingState label="Loading portal profiles" />
    {:else}
      <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); void disableProfile(); }}>
        <label class="form-control gap-1 max-w-xl">
          <span class="label-text text-xs">Portal profile</span>
          <select class="select select-bordered select-sm" bind:value={portalId} required>
            <option value="" disabled>Select a portal profile</option>
            {#each profiles as profile (profile.portalId)}
              <option value={profile.portalId}>{profile.portalId}{profile.disabled ? " (disabled)" : ""}</option>
            {/each}
          </select>
        </label>

        {#if selectedProfile}
          <div class="rounded-box border border-base-300 bg-base-100 p-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono font-medium">{selectedProfile.portalId}</span>
              <StatusBadge label={selectedProfile.disabled ? "Disabled" : "Active"} status={selectedProfile.disabled ? "offline" : "healthy"} />
            </div>
            <div class="mt-1 text-sm text-base-content/60">{selectedProfile.entryUrl}</div>
          </div>
        {/if}

        <div class="flex flex-wrap items-center gap-2">
          <button type="submit" class="btn btn-error btn-sm" disabled={!selectedProfile || selectedProfile.disabled || pending}>{pending ? "Disabling…" : "Disable Portal Profile"}</button>
          <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals")}>Cancel</a>
        </div>
      </form>
    {/if}
  </Panel>
</section>
