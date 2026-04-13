<script lang="ts">
  import type {
    AuthClearDevicePortalSelectionInput,
    AuthGetDevicePortalDefaultOutput,
    AuthListDevicePortalSelectionsOutput,
    AuthListDeviceProfilesOutput,
    AuthListPortalsOutput,
    AuthSetDevicePortalDefaultInput,
    AuthSetDevicePortalSelectionInput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { isErr } from "@qlever-llc/result";
  import { onMount } from "svelte";
  import { errorMessage } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  const BUILTIN_OPTION = "__builtin__";
  const INHERIT_OPTION = "__inherit__";

  type PortalRecord = AuthListPortalsOutput["portals"][number];
  type ProfileRecord = AuthListDeviceProfilesOutput["profiles"][number];
  type SelectionRecord = AuthListDevicePortalSelectionsOutput["selections"][number];
  type DefaultPortal = AuthGetDevicePortalDefaultOutput["defaultPortal"];

  const trellisPromise = getTrellis();
  const notifications = getNotifications();

  async function requestOrThrow<T>(method: string, input: unknown): Promise<T> {
    const trellis = await trellisPromise;
    const result = await trellis.request(method, input);
    const value = result.take();
    if (isErr(value)) throw value.error;
    return value as T;
  }

  let loading = $state(true);
  let error = $state<string | null>(null);

  let portals = $state<PortalRecord[]>([]);
  let profiles = $state<ProfileRecord[]>([]);
  let selections = $state<SelectionRecord[]>([]);
  let defaultPortal = $state<DefaultPortal>({ portalId: null });

  let defaultDraft = $state(BUILTIN_OPTION);
  let selectionDrafts = $state<Record<string, string>>({});

  let defaultPending = $state(false);
  let saveTarget = $state<string | null>(null);
  let clearTarget = $state<string | null>(null);

  const portalById = $derived(new Map(portals.map((portal) => [portal.portalId, portal])));
  const selectionByProfileId = $derived(new Map(selections.map((selection) => [selection.profileId, selection])));

  function optionToPortalId(option: string): string | null {
    return option === BUILTIN_OPTION ? null : option;
  }

  function portalIdToOption(portalId: string | null | undefined): string {
    return portalId ?? BUILTIN_OPTION;
  }

  function selectionOption(profileId: string): string {
    return portalIdToOption(selectionByProfileId.get(profileId)?.portalId);
  }

  function portalLabel(portalId: string | null | undefined): string {
    if (portalId == null) return "Built-in portal";
    const portal = portalById.get(portalId);
    if (!portal) return `${portalId} (missing)`;
    return portal.disabled ? `${portal.portalId} (disabled)` : portal.portalId;
  }

  function effectivePortalLabel(profileId: string): string {
    const explicit = selectionByProfileId.get(profileId);
    const portalId = explicit?.portalId ?? defaultPortal.portalId;
    const source = explicit ? "selection" : "default";
    return `${portalLabel(portalId)} · ${source}`;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [portalRes, profileRes, defaultRes, selectionRes] = await Promise.all([
        requestOrThrow<AuthListPortalsOutput>("Auth.ListPortals", {}),
        requestOrThrow<AuthListDeviceProfilesOutput>("Auth.ListDeviceProfiles", {}),
        requestOrThrow<AuthGetDevicePortalDefaultOutput>("Auth.GetDevicePortalDefault", {}),
        requestOrThrow<AuthListDevicePortalSelectionsOutput>("Auth.ListDevicePortalSelections", {}),
      ]);

      portals = portalRes.portals ?? [];
      profiles = profileRes.profiles ?? [];
      defaultPortal = defaultRes.defaultPortal ?? { portalId: null };
      selections = selectionRes.selections ?? [];
      defaultDraft = portalIdToOption(defaultRes.defaultPortal?.portalId);
      selectionDrafts = Object.fromEntries(
        (profileRes.profiles ?? []).map((profile) => {
          const selection = (selectionRes.selections ?? []).find((entry) => entry.profileId === profile.profileId);
          return [profile.profileId, selection ? portalIdToOption(selection.portalId) : INHERIT_OPTION];
        }),
      );
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function saveDefault() {
    defaultPending = true;
    error = null;
    try {
      await requestOrThrow("Auth.SetDevicePortalDefault", {
        portalId: optionToPortalId(defaultDraft),
      } satisfies AuthSetDevicePortalDefaultInput);
      notifications.success("Default device portal updated.", "Updated");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      defaultPending = false;
    }
  }

  async function saveSelection(profileId: string) {
    saveTarget = profileId;
    error = null;
    try {
      const option = selectionDrafts[profileId] ?? INHERIT_OPTION;
      if (option === INHERIT_OPTION) {
        await requestOrThrow("Auth.ClearDevicePortalSelection", {
          profileId,
        } satisfies AuthClearDevicePortalSelectionInput);
        notifications.success(`Device policy cleared for ${profileId}.`, "Cleared");
      } else {
        await requestOrThrow("Auth.SetDevicePortalSelection", {
          profileId,
          portalId: optionToPortalId(option),
        } satisfies AuthSetDevicePortalSelectionInput);
        notifications.success(`Device policy updated for ${profileId}.`, "Updated");
      }
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saveTarget = null;
    }
  }

  async function clearSelection(profileId: string) {
    if (!selectionByProfileId.get(profileId)) return;
    if (!window.confirm(`Clear the device portal override for ${profileId}?`)) return;
    clearTarget = profileId;
    error = null;
    try {
      await requestOrThrow("Auth.ClearDevicePortalSelection", {
        profileId,
      } satisfies AuthClearDevicePortalSelectionInput);
      notifications.success(`Device policy cleared for ${profileId}.`, "Cleared");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      clearTarget = null;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <div class="flex items-center justify-end">
    <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
  </div>

  <div class="card border border-base-300 bg-base-100">
    <div class="card-body gap-4">
      <div>
        <h2 class="card-title text-base">Default device portal</h2>
        <p class="text-sm text-base-content/60">Choose the portal used when a device profile does not have an explicit portal policy.</p>
      </div>

      <form class="flex flex-col gap-3 md:flex-row md:items-end" onsubmit={(event) => { event.preventDefault(); void saveDefault(); }}>
        <label class="form-control gap-1 md:min-w-96">
          <span class="label-text text-xs">Default portal</span>
          <select class="select select-bordered select-sm" bind:value={defaultDraft}>
            <option value={BUILTIN_OPTION}>Built-in portal</option>
            {#each portals as portal (portal.portalId)}
              <option value={portal.portalId} disabled={portal.disabled}>{portalLabel(portal.portalId)}</option>
            {/each}
          </select>
        </label>

        <div class="text-sm text-base-content/60 md:pb-2">Current: {portalLabel(defaultPortal.portalId)}</div>

        <button type="submit" class="btn btn-primary btn-sm" disabled={defaultPending || defaultDraft === portalIdToOption(defaultPortal.portalId)}>
          {defaultPending ? "Saving…" : "Save Default"}
        </button>
      </form>
    </div>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
  {:else if profiles.length === 0}
    <p class="text-sm text-base-content/60">No device profiles found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Profile</th>
            <th>Current</th>
            <th>Override</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each profiles as profile (profile.profileId)}
            <tr>
              <td>
                <div class="font-medium">{profile.profileId}</div>
                <div class="text-xs text-base-content/60">{profile.contractId} · review {profile.reviewMode ?? "none"}</div>
              </td>
              <td class="text-sm text-base-content/60">{effectivePortalLabel(profile.profileId)}</td>
              <td>
                <select class="select select-bordered select-xs w-full max-w-72" bind:value={selectionDrafts[profile.profileId]}>
                  <option value={INHERIT_OPTION}>Use default portal</option>
                  <option value={BUILTIN_OPTION}>Built-in portal</option>
                  {#each portals as portal (portal.portalId)}
                    <option value={portal.portalId} disabled={portal.disabled}>{portalLabel(portal.portalId)}</option>
                  {/each}
                </select>
              </td>
              <td class="text-right">
                <div class="flex justify-end gap-2">
                  <button
                    class="btn btn-primary btn-xs"
                    onclick={() => saveSelection(profile.profileId)}
                    disabled={saveTarget === profile.profileId || clearTarget === profile.profileId || selectionDrafts[profile.profileId] === (selectionByProfileId.get(profile.profileId) ? selectionOption(profile.profileId) : INHERIT_OPTION) || profile.disabled}
                  >
                    {saveTarget === profile.profileId ? "Saving…" : "Apply"}
                  </button>

                  <button
                    class="btn btn-ghost btn-xs"
                    onclick={() => clearSelection(profile.profileId)}
                    disabled={clearTarget === profile.profileId || saveTarget === profile.profileId || !selectionByProfileId.get(profile.profileId)}
                  >
                    {clearTarget === profile.profileId ? "Clearing…" : "Clear"}
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
