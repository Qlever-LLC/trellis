<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  const BUILTIN_PORTAL_ID = "trellis.builtin.login";
  const trellis = getTrellis();

  type Portal = { portalId: string; displayName: string; updatedAt: string };
  type Settings = {
    localRegistrationEnabled: boolean;
    federatedRegistrationEnabled: boolean;
    selfRegisteredAccountActive: boolean;
    updatedAt: string;
  };

  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let portal = $state<Portal | null>(null);
  let settings = $state<Settings | null>(null);
  let localRegistrationEnabled = $state(true);
  let federatedRegistrationEnabled = $state(true);
  let selfRegisteredAccountActive = $state(true);
  let defaultCapabilitiesText = $state("");
  let defaultCapabilityGroupsText = $state("");

  function lines(value: string): string[] {
    return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  }

  async function load() {
    loading = true;
    error = null;
    saved = null;
    try {
      const response = await trellis.request("Auth.Portals.LoginSettings.Get", { portalId: BUILTIN_PORTAL_ID }).take();
      if (isErr(response)) {
        error = errorMessage(response);
        return;
      }
      portal = response.portal;
      settings = response.settings;
      localRegistrationEnabled = response.settings.localRegistrationEnabled;
      federatedRegistrationEnabled = response.settings.federatedRegistrationEnabled;
      selfRegisteredAccountActive = response.settings.selfRegisteredAccountActive;
      defaultCapabilitiesText = response.defaultCapabilities.join("\n");
      defaultCapabilityGroupsText = response.defaultCapabilityGroups.join("\n");
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function save() {
    saving = true;
    error = null;
    saved = null;
    try {
      const response = await trellis.request("Auth.Portals.LoginSettings.Update", {
        portalId: BUILTIN_PORTAL_ID,
        localRegistrationEnabled,
        federatedRegistrationEnabled,
        selfRegisteredAccountActive,
        defaultCapabilities: lines(defaultCapabilitiesText),
        defaultCapabilityGroups: lines(defaultCapabilityGroupsText),
      }).take();
      if (isErr(response)) {
        error = errorMessage(response);
        return;
      }
      portal = response.portal;
      settings = response.settings;
      defaultCapabilitiesText = response.defaultCapabilities.join("\n");
      defaultCapabilityGroupsText = response.defaultCapabilityGroups.join("\n");
      saved = "Default login registration settings saved.";
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  onMount(() => { void load(); });
</script>

<section class="space-y-4">
  <PageToolbar title="Default login portal" description="Built-in login registration policy and default grants.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals")}>Back to portals</a>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading || saving}>Refresh</button>
      <button class="btn btn-primary btn-sm" onclick={save} disabled={loading || saving}>{saving ? "Saving" : "Save"}</button>
    {/snippet}
  </PageToolbar>

  {#if error}<div class="alert alert-error"><span>{error}</span></div>{/if}
  {#if saved}<div class="alert alert-success"><span>{saved}</span></div>{/if}

  {#if loading}
    <Panel><LoadingState label="Loading login settings" /></Panel>
  {:else}
    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Panel title="Registration policy" eyebrow={portal?.portalId ?? BUILTIN_PORTAL_ID}>
        <div class="grid gap-3 sm:grid-cols-3">
          <label class="flex items-center justify-between gap-3 rounded border border-base-300 px-3 py-2 text-sm">
            <span>Local identity</span>
            <input class="toggle toggle-sm toggle-primary" type="checkbox" bind:checked={localRegistrationEnabled} />
          </label>
          <label class="flex items-center justify-between gap-3 rounded border border-base-300 px-3 py-2 text-sm">
            <span>Federated identity</span>
            <input class="toggle toggle-sm toggle-primary" type="checkbox" bind:checked={federatedRegistrationEnabled} />
          </label>
          <label class="flex items-center justify-between gap-3 rounded border border-base-300 px-3 py-2 text-sm">
            <span>New accounts active</span>
            <input class="toggle toggle-sm toggle-primary" type="checkbox" bind:checked={selfRegisteredAccountActive} />
          </label>
        </div>
        <div class="mt-4 grid gap-3 md:grid-cols-2">
          <label class="form-control">
            <span class="label-text mb-1 text-xs uppercase tracking-wide text-base-content/55">Default capabilities</span>
            <textarea class="textarea textarea-bordered min-h-40 font-mono text-xs" bind:value={defaultCapabilitiesText} placeholder="One capability per line or comma separated"></textarea>
          </label>
          <label class="form-control">
            <span class="label-text mb-1 text-xs uppercase tracking-wide text-base-content/55">Default capability groups</span>
            <textarea class="textarea textarea-bordered min-h-40 font-mono text-xs" bind:value={defaultCapabilityGroupsText} placeholder="One group key per line or comma separated"></textarea>
          </label>
        </div>
      </Panel>
      <Panel title="Projection" eyebrow="Read model">
        <dl class="space-y-3 text-sm">
          <div><dt class="text-xs uppercase text-base-content/45">Portal</dt><dd class="font-medium">{portal?.displayName ?? "Trellis Login"}</dd></div>
          <div><dt class="text-xs uppercase text-base-content/45">Updated</dt><dd>{formatDate(settings?.updatedAt)}</dd></div>
          <div><dt class="text-xs uppercase text-base-content/45">Route selection</dt><dd><a class="link" href={resolve("/admin/portals/login/selection")}>Manage login routes</a></dd></div>
        </dl>
      </Panel>
    </div>
  {/if}
</section>
