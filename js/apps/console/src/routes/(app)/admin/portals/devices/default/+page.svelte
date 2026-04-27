<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthGetDevicePortalDefaultOutput,
    AuthListPortalsOutput,
    AuthSetDevicePortalDefaultInput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "../../../../../../lib/format";
  import { getNotifications } from "../../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../../lib/trellis";

  const BUILTIN_OPTION = "__builtin__";

  type PortalRecord = AuthListPortalsOutput["portals"][number];
  type DefaultPortal = AuthGetDevicePortalDefaultOutput["defaultPortal"];

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let pending = $state(false);
  let error = $state<string | null>(null);
  let feedback = $state<string | null>(null);
  let portals = $state<PortalRecord[]>([]);
  let defaultPortal = $state<DefaultPortal>({ portalId: null });
  let defaultDraft = $state(BUILTIN_OPTION);

  const portalById = $derived(new Map(portals.map((portal) => [portal.portalId, portal])));

  function optionToPortalId(option: string): string | null {
    return option === BUILTIN_OPTION ? null : option;
  }

  function portalIdToOption(portalId: string | null | undefined): string {
    return portalId ?? BUILTIN_OPTION;
  }

  function portalLabel(portalId: string | null | undefined): string {
    if (portalId == null) return "Built-in portal";
    const portal = portalById.get(portalId);
    if (!portal) return `${portalId} (missing)`;
    return portal.disabled ? `${portal.portalId} (disabled)` : portal.portalId;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [portalRes, defaultRes] = await Promise.all([
        trellis.request("Auth.ListPortals", {}).take(),
        trellis.request("Auth.GetDevicePortalDefault", {}).take(),
      ]);
      if (isErr(portalRes)) { error = errorMessage(portalRes); return; }
      if (isErr(defaultRes)) { error = errorMessage(defaultRes); return; }
      portals = portalRes.portals ?? [];
      defaultPortal = defaultRes.defaultPortal ?? { portalId: null };
      defaultDraft = portalIdToOption(defaultPortal.portalId);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function saveDefault() {
    pending = true;
    error = null;
    feedback = null;
    try {
      const response = await trellis.request("Auth.SetDevicePortalDefault", {
        portalId: optionToPortalId(defaultDraft),
      } satisfies AuthSetDevicePortalDefaultInput).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      feedback = "Default device portal updated.";
      notifications.success(feedback, "Updated");
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
  <PageToolbar title="Default device portal" description="Set the fallback portal used for device onboarding.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals/devices")}>Back to device policy</a>
    {/snippet}
  </PageToolbar>

  {#if error}<div class="alert alert-error"><span>{error}</span></div>{/if}
  {#if feedback}<div class="alert alert-success"><span>{feedback}</span></div>{/if}

  <Panel title="Set default" eyebrow="Device portal">
    {#if loading}
      <LoadingState label="Loading device portal default" />
    {:else}
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
        <button type="submit" class="btn btn-outline btn-sm" disabled={pending || defaultDraft === portalIdToOption(defaultPortal.portalId)}>{pending ? "Saving…" : "Save Default"}</button>
      </form>
    {/if}
  </Panel>
</section>
