<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthCapabilitiesListOutput,
    AuthCapabilityGroupsListOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import ChoiceRow from "$lib/components/ChoiceRow.svelte";
  import ConfirmationModal from "$lib/components/ConfirmationModal.svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import SelectionGroup from "$lib/components/SelectionGroup.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type Portal = {
    portalId: string;
    displayName: string;
    entryUrl: string | null;
    builtIn: boolean;
    disabled: boolean;
    createdAt: string;
    updatedAt: string;
  };

  type Settings = {
    portalId: string;
    localRegistrationEnabled: boolean;
    federatedRegistrationEnabled: boolean;
    allowedFederatedProviders?: string[] | null;
    selfRegisteredAccountActive: boolean;
    updatedAt: string;
  };

  type FederatedProvider = {
    id: string;
    displayName: string;
    type: string;
  };

  type Route = {
    routeKey: string;
    portalId: string;
    contractId: string | null;
    origin: string | null;
    disabled: boolean;
    updatedAt: string;
  };

  type CapabilityView = AuthCapabilitiesListOutput["entries"][number];
  type CapabilityGroupView = AuthCapabilityGroupsListOutput["entries"][number];

  const CATALOG_PAGE_SIZE = 500;

  let { mode, targetPortalId = null }: { mode: "create" | "edit"; targetPortalId?: string | null } = $props();

  const trellis = getTrellis();
  let loading = $state(true);
  let saving = $state(false);
  let savingRoute = $state(false);
  let removingRouteKey = $state<string | null>(null);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let portal = $state<Portal | null>(null);
  let settings = $state<Settings | null>(null);
  let routes = $state.raw<Route[]>([]);
  let capabilities = $state.raw<CapabilityView[]>([]);
  let capabilityGroups = $state.raw<CapabilityGroupView[]>([]);
  let federatedProviders = $state.raw<FederatedProvider[]>([]);

  let portalId = $state("");
  let displayName = $state("");
  let entryUrl = $state("");
  let disabled = $state(false);
  let localRegistrationEnabled = $state(true);
  let federatedRegistrationEnabled = $state(true);
  let providerRestrictionMode = $state<"all" | "selected">("all");
  let selectedFederatedProviderIds = $state<string[]>([]);
  let selfRegisteredAccountActive = $state(true);
  let selectedDefaultCapabilities = $state<string[]>([]);
  let selectedDefaultCapabilityGroups = $state<string[]>([]);
  let editingRouteKey = $state<string | null>(null);
  let routeContractId = $state("");
  let routeOrigin = $state("");
  let routeDisabled = $state(false);
  let confirmationModal: ConfirmationModal | undefined = $state();

  const editingExisting = $derived(mode === "edit");
  const metadataReadOnly = $derived(portal?.builtIn === true);
  const routeBusy = $derived(savingRoute || removingRouteKey !== null);
  const busy = $derived(loading || saving || routeBusy);
  const activeRouteCount = $derived(routes.filter((route) => !route.disabled).length);
  const sortedRoutes = $derived.by(() => [...routes].sort((a, b) => routeSortKey(a).localeCompare(routeSortKey(b))));
  const catalogedCapabilityKeys = $derived(new Set(capabilities.map((capability) => capability.key)));
  const catalogedCapabilityGroupKeys = $derived(new Set(capabilityGroups.map((group) => group.groupKey)));
  const uncatalogedSelectedCapabilities = $derived(selectedDefaultCapabilities.filter((key) => !catalogedCapabilityKeys.has(key)).sort());
  const uncatalogedSelectedCapabilityGroups = $derived(selectedDefaultCapabilityGroups.filter((key) => !catalogedCapabilityGroupKeys.has(key)).sort());
  const sortedCapabilityGroups = $derived(capabilityGroups.slice().sort((left, right) => {
    if ((left.groupKey === "admin") !== (right.groupKey === "admin")) return left.groupKey === "admin" ? -1 : 1;
    return left.groupKey.localeCompare(right.groupKey);
  }));
  const selectedFederatedProviderCount = $derived(uniqueValues(selectedFederatedProviderIds).length);

  function uniqueValues(values: string[]): string[] {
    return Array.from(new Set(values));
  }

  function localCapabilityKey(key: string): string {
    return key.includes("::") ? key.split("::").slice(1).join("::") : key;
  }

  function providerTypeLabel(type: string): string {
    return type === "oidc" ? "OIDC" : type;
  }

  function routeMatch(route: Route): string {
    return `${route.contractId ?? "any contract"} / ${route.origin ?? "any origin"}`;
  }

  function routeKind(route: Route): string {
    if (route.contractId && route.origin) return "contract + origin";
    if (route.contractId) return "contract only";
    if (route.origin) return "origin only";
    return "default route";
  }

  function routePriority(route: Route): number {
    if (route.contractId && route.origin) return 1;
    if (route.contractId) return 2;
    if (route.origin) return 3;
    return 4;
  }

  function routeSortKey(route: Route): string {
    return `${route.disabled ? 1 : 0}:${routePriority(route)}:${routeMatch(route)}`;
  }

  function federatedProviderInputId(providerId: string): string {
    return `federated-provider-${providerId}`;
  }

  function setFederatedProviderSelected(providerId: string, selected: boolean) {
    selectedFederatedProviderIds = selected
      ? uniqueValues([...selectedFederatedProviderIds, providerId])
      : selectedFederatedProviderIds.filter((selectedId) => selectedId !== providerId);
  }

  function setDefaultCapabilitySelected(capabilityKey: string, selected: boolean) {
    selectedDefaultCapabilities = selected
      ? uniqueValues([...selectedDefaultCapabilities, capabilityKey])
      : selectedDefaultCapabilities.filter((selectedKey) => selectedKey !== capabilityKey);
  }

  function setDefaultCapabilityGroupSelected(groupKey: string, selected: boolean) {
    selectedDefaultCapabilityGroups = selected
      ? uniqueValues([...selectedDefaultCapabilityGroups, groupKey])
      : selectedDefaultCapabilityGroups.filter((selectedKey) => selectedKey !== groupKey);
  }

  function handleDefaultCapabilityChange(capabilityKey: string, event: Event) {
    setDefaultCapabilitySelected(capabilityKey, (event.currentTarget as HTMLInputElement).checked);
  }

  function handleDefaultCapabilityGroupChange(groupKey: string, event: Event) {
    setDefaultCapabilityGroupSelected(groupKey, (event.currentTarget as HTMLInputElement).checked);
  }

  function handleFederatedProviderChange(providerId: string, event: Event) {
    setFederatedProviderSelected(providerId, (event.currentTarget as HTMLInputElement).checked);
  }

  function handleAllowAllProvidersChange(event: Event) {
    providerRestrictionMode = (event.currentTarget as HTMLInputElement).checked ? "all" : "selected";
  }

  function handlePortalEnabledChange(event: Event) {
    disabled = !(event.currentTarget as HTMLInputElement).checked;
  }

  function handleRouteEnabledChange(event: Event) {
    routeDisabled = !(event.currentTarget as HTMLInputElement).checked;
  }

  function resetRouteForm() {
    editingRouteKey = null;
    routeContractId = "";
    routeOrigin = "";
    routeDisabled = false;
  }

  function editRoute(route: Route) {
    editingRouteKey = route.routeKey;
    routeContractId = route.contractId ?? "";
    routeOrigin = route.origin ?? "";
    routeDisabled = route.disabled;
  }

  function applySettingsResponse(response: {
    portal: Portal;
    settings: Settings;
    defaultCapabilities: string[];
    defaultCapabilityGroups: string[];
    federatedProviders?: FederatedProvider[];
    routes?: Route[];
  }) {
    portal = response.portal;
    settings = response.settings;
    portalId = response.portal.portalId;
    displayName = response.portal.displayName;
    entryUrl = response.portal.entryUrl ?? "";
    disabled = response.portal.disabled;
    localRegistrationEnabled = response.settings.localRegistrationEnabled;
    federatedRegistrationEnabled = response.settings.federatedRegistrationEnabled;
    if (response.settings.allowedFederatedProviders === undefined || response.settings.allowedFederatedProviders === null) {
      providerRestrictionMode = "all";
      selectedFederatedProviderIds = [];
    } else {
      providerRestrictionMode = "selected";
      selectedFederatedProviderIds = uniqueValues(response.settings.allowedFederatedProviders);
    }
    selfRegisteredAccountActive = response.settings.selfRegisteredAccountActive;
    selectedDefaultCapabilities = uniqueValues(response.defaultCapabilities);
    selectedDefaultCapabilityGroups = uniqueValues(response.defaultCapabilityGroups);
    federatedProviders = response.federatedProviders ?? [];
    routes = response.routes ?? routes;
  }

  async function loadPortalDetail(target: string) {
    const response = await trellis.request("Auth.Portals.Get", { portalId: target }).take();
    if (isErr(response)) {
      error = errorMessage(response);
      return;
    }
    applySettingsResponse(response);
  }

  async function loadAllCapabilities(): Promise<CapabilityView[]> {
    const loaded: CapabilityView[] = [];
    for (let offset = 0; ; offset += CATALOG_PAGE_SIZE) {
      const response = await trellis.request("Auth.Capabilities.List", { limit: CATALOG_PAGE_SIZE, offset }).take();
      if (isErr(response)) throw new Error(errorMessage(response));
      const page = response.entries ?? [];
      loaded.push(...page);
      if (page.length < CATALOG_PAGE_SIZE) return loaded.sort((left, right) => left.key.localeCompare(right.key));
    }
  }

  async function loadAllCapabilityGroups(): Promise<CapabilityGroupView[]> {
    const loaded: CapabilityGroupView[] = [];
    for (let offset = 0; ; offset += CATALOG_PAGE_SIZE) {
      const response = await trellis.request("Auth.CapabilityGroups.List", { limit: CATALOG_PAGE_SIZE, offset }).take();
      if (isErr(response)) throw new Error(errorMessage(response));
      const page = response.entries ?? [];
      loaded.push(...page);
      if (page.length < CATALOG_PAGE_SIZE) return loaded;
    }
  }

  async function loadCatalogs() {
    const [loadedCapabilities, loadedCapabilityGroups] = await Promise.all([
      loadAllCapabilities(),
      loadAllCapabilityGroups(),
    ]);
    capabilities = loadedCapabilities;
    capabilityGroups = loadedCapabilityGroups;
  }

  async function load() {
    loading = true;
    error = null;
    saved = null;
    try {
      await loadCatalogs();
      if (!editingExisting) return;
      if (!targetPortalId) {
        error = "Portal ID is required.";
        return;
      }
      await loadPortalDetail(targetPortalId);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function save(event?: SubmitEvent) {
    event?.preventDefault();
    const trimmedPortalId = portalId.trim();
    const trimmedDisplayName = displayName.trim();
    const trimmedEntryUrl = entryUrl.trim();
    if (!editingExisting && !trimmedPortalId) {
      error = "Portal ID is required.";
      saved = null;
      return;
    }
    if (!metadataReadOnly && (!trimmedDisplayName || !trimmedEntryUrl)) {
      error = "Display name and entry URL are required.";
      saved = null;
      return;
    }

    const target = portal?.portalId ?? trimmedPortalId;
    if (editingExisting && portal && !portal.disabled && disabled) {
      const confirmed = await confirmationModal?.confirm({
        title: "Disable portal?",
        message: "This disables the portal record after the settings are saved.",
        confirmLabel: "Disable portal",
        targetLabel: "Portal",
        targetName: target,
        expectedValue: target,
      });
      if (!confirmed) return;
    }

    saving = true;
    error = null;
    saved = null;
    try {
      if (!metadataReadOnly) {
        const portalResponse = await trellis.request("Auth.Portals.Put", {
          portalId: target,
          displayName: trimmedDisplayName,
          entryUrl: trimmedEntryUrl,
          disabled,
        }).take();
        if (isErr(portalResponse)) {
          error = errorMessage(portalResponse);
          return;
        }
      }

      const settingsResponse = await trellis.request("Auth.Portals.LoginSettings.Update", {
        portalId: target,
        localRegistrationEnabled,
        federatedRegistrationEnabled,
        allowedFederatedProviders: providerRestrictionMode === "all" ? null : uniqueValues(selectedFederatedProviderIds),
        selfRegisteredAccountActive,
        defaultCapabilities: uniqueValues(selectedDefaultCapabilities),
        defaultCapabilityGroups: uniqueValues(selectedDefaultCapabilityGroups),
      }).take();
      if (isErr(settingsResponse)) {
        error = errorMessage(settingsResponse);
        return;
      }
      applySettingsResponse(settingsResponse);
      saved = metadataReadOnly ? "Portal settings saved." : "Portal saved.";
      if (!editingExisting) await goto(resolve("/admin/portals"));
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  async function saveRoute() {
    if (!portal) return;
    const existingRoute = editingRouteKey ? routes.find((route) => route.routeKey === editingRouteKey) ?? null : null;
    if (existingRoute && !existingRoute.disabled && routeDisabled) {
      const confirmed = await confirmationModal?.confirm({
        title: "Disable portal route?",
        message: "This disables the selected portal route after the route is saved.",
        confirmLabel: "Disable route",
        targetLabel: "Route",
        targetName: routeMatch(existingRoute),
        expectedValue: existingRoute.routeKey,
        details: `Route key: ${existingRoute.routeKey}`,
      });
      if (!confirmed) return;
    }

    savingRoute = true;
    error = null;
    saved = null;
    try {
      const response = await trellis.request("Auth.Portals.Routes.Put", {
        portalId: portal.portalId,
        contractId: routeContractId.trim() || null,
        origin: routeOrigin.trim() || null,
        disabled: routeDisabled,
      }).take();
      if (isErr(response)) {
        error = errorMessage(response);
        return;
      }
      saved = "Portal route saved.";
      resetRouteForm();
      await loadPortalDetail(portal.portalId);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      savingRoute = false;
    }
  }

  async function removeRoute(route: Route) {
    removingRouteKey = route.routeKey;
    error = null;
    saved = null;
    try {
      const response = await trellis.request("Auth.Portals.Routes.Remove", {
        portalId: route.portalId,
        contractId: route.contractId,
        origin: route.origin,
      }).take();
      if (isErr(response)) {
        error = errorMessage(response);
        return;
      }
      saved = response.success ? "Portal route removed." : "Portal route was already absent.";
      if (editingRouteKey === route.routeKey) resetRouteForm();
      await loadPortalDetail(route.portalId);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      removingRouteKey = null;
    }
  }

  async function requestRemoveRoute(route: Route) {
    const confirmed = await confirmationModal?.confirm({
      title: "Remove portal route?",
      message: "This removes the route rule from the portal.",
      confirmLabel: "Remove route",
      targetLabel: "Route",
      targetName: routeMatch(route),
      expectedValue: route.routeKey,
      details: `Route key: ${route.routeKey}`,
    });
    if (confirmed) await removeRoute(route);
  }

  onMount(() => { void load(); });
</script>

<section class="mx-auto max-w-5xl space-y-4">
  <div>
    <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals")}>Back to portals</a>
  </div>

  {#if error}
    <Notice variant="error">{error}</Notice>
  {/if}
  {#if saved}
    <Notice variant="success">{saved}</Notice>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading portal" /></Panel>
  {:else}
    <form class="space-y-4" onsubmit={save}>
      <Panel title="Portal" eyebrow={metadataReadOnly ? "Built-in" : undefined}>
        {#snippet actions()}
          <span class="trellis-metadata text-[0.65rem]">Updated {settings ? formatDate(settings.updatedAt) : "not saved"}</span>
        {/snippet}

        <div class="grid gap-3 md:grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)]">
          <label class="form-control">
            <span class="label-text text-xs uppercase tracking-wide text-base-content/55">Enabled</span>
            <span class="flex h-8 items-center px-1">
              <input class="toggle toggle-sm toggle-primary" type="checkbox" checked={!disabled} disabled={busy || metadataReadOnly} onchange={handlePortalEnabledChange} />
            </span>
          </label>
          <label class="form-control">
            <span class="label-text text-xs uppercase tracking-wide text-base-content/55">Portal ID</span>
            <input class="input input-bordered input-sm font-mono" bind:value={portalId} disabled={busy || editingExisting} required={!editingExisting} />
          </label>
          <label class="form-control">
            <span class="label-text text-xs uppercase tracking-wide text-base-content/55">Display name</span>
            <input class="input input-bordered input-sm" bind:value={displayName} disabled={busy || metadataReadOnly} required={!metadataReadOnly} />
          </label>
          <label class="form-control md:col-span-3">
            <span class="label-text text-xs uppercase tracking-wide text-base-content/55">Entry URL</span>
            <input class="input input-bordered input-sm font-mono" bind:value={entryUrl} disabled={busy || metadataReadOnly} required={!metadataReadOnly} />
          </label>
        </div>
      </Panel>

      <Panel title="Account creation rules" eyebrow="Login settings">
        <div class="space-y-3">
          <div class="rounded border border-base-300 px-3 py-2 text-sm">
            <label class="flex items-start justify-between gap-3">
              <span class="min-w-0">
                <span class="block font-medium">Accounts active on creation</span>
                <span class="mt-0.5 block text-xs text-base-content/60">New self-registered accounts start active.</span>
              </span>
              <input class="toggle toggle-sm toggle-primary" type="checkbox" bind:checked={selfRegisteredAccountActive} disabled={busy} />
            </label>
          </div>

          <div class="text-xs uppercase tracking-wide text-base-content/55">Registration methods</div>

          <div class="rounded border border-base-300 px-3 py-2 text-sm">
            <label class="flex items-start justify-between gap-3">
              <span class="min-w-0">
                <span class="block font-medium">Local registration</span>
                <span class="mt-0.5 block text-xs text-base-content/60">Username and password signup.</span>
              </span>
              <input class="toggle toggle-sm toggle-primary" type="checkbox" bind:checked={localRegistrationEnabled} disabled={busy} />
            </label>
          </div>

          <div class="rounded border border-base-300 px-3 py-2 text-sm">
            <label class="flex items-start justify-between gap-3">
              <span class="min-w-0">
                <span class="block font-medium">Federated registration</span>
                <span class="mt-0.5 block text-xs text-base-content/60">Signup through configured providers.</span>
              </span>
              <input class="toggle toggle-sm toggle-primary" type="checkbox" bind:checked={federatedRegistrationEnabled} disabled={busy} />
            </label>

            <div class="mt-2 space-y-2 border-t border-base-300/70 pt-2">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <label class="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <input class="checkbox checkbox-sm" type="checkbox" checked={providerRestrictionMode === "all"} disabled={busy || !federatedRegistrationEnabled} onchange={handleAllowAllProvidersChange} />
                  <span>Allow all providers</span>
                </label>
                <span class="trellis-metadata text-[0.65rem]">
                  {#if providerRestrictionMode === "selected"}
                    {selectedFederatedProviderCount} selected / {federatedProviders.length} configured
                  {:else}
                    {federatedProviders.length} configured
                  {/if}
                </span>
              </div>

              <div class="space-y-1">
                {#each federatedProviders as provider (provider.id)}
                  <label class="grid grid-cols-[auto_1fr] items-start gap-2 py-1 text-xs hover:bg-base-200/60" for={federatedProviderInputId(provider.id)}>
                    <input
                      id={federatedProviderInputId(provider.id)}
                      class="checkbox checkbox-xs mt-0.5"
                      type="checkbox"
                      checked={providerRestrictionMode === "all" || selectedFederatedProviderIds.includes(provider.id)}
                      disabled={busy || !federatedRegistrationEnabled || providerRestrictionMode === "all"}
                      onchange={(event) => handleFederatedProviderChange(provider.id, event)}
                    />
                    <span class="min-w-0">
                      <span class="block truncate font-medium leading-tight">{provider.displayName}</span>
                      <span class="block truncate font-mono text-[0.68rem] leading-tight text-base-content/55">{provider.id} | {providerTypeLabel(provider.type)}</span>
                    </span>
                  </label>
                {:else}
                  <div class="py-1 text-xs text-base-content/60">No federated providers configured.</div>
                {/each}
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Default grants for new accounts" eyebrow="New users">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="form-control">
            <div class="mb-1 flex items-baseline justify-between gap-2">
              <span class="label-text text-xs uppercase tracking-wide text-base-content/55">Default capabilities</span>
              <span class="trellis-metadata text-[0.65rem]">{selectedDefaultCapabilities.length} selected</span>
            </div>
            <SelectionGroup title="Default capabilities" count={selectedDefaultCapabilities.length} bodyClass="max-h-72 overflow-y-auto rounded border border-base-300 bg-base-100/40">
              {#each capabilities as capability (capability.key)}
                <ChoiceRow>
                  {#snippet input()}
                    <input class="checkbox checkbox-sm mt-0.5" type="checkbox" checked={selectedDefaultCapabilities.includes(capability.key)} disabled={busy} onchange={(event) => handleDefaultCapabilityChange(capability.key, event)} />
                  {/snippet}
                  <span class="min-w-0">
                    <span class="block font-medium text-base-content">{capability.description}</span>
                    <span class="trellis-identifier mt-0.5 block break-all text-base-content/50">{localCapabilityKey(capability.key)}</span>
                  </span>
                </ChoiceRow>
              {:else}
                <div class="px-2 py-3 trellis-metadata text-xs">No cataloged capabilities were returned.</div>
              {/each}
              {#each uncatalogedSelectedCapabilities as capabilityKey (capabilityKey)}
                <ChoiceRow class="border-t">
                  {#snippet input()}
                    <input class="checkbox checkbox-sm mt-0.5" type="checkbox" checked={selectedDefaultCapabilities.includes(capabilityKey)} disabled={busy} onchange={(event) => handleDefaultCapabilityChange(capabilityKey, event)} />
                  {/snippet}
                  <span class="min-w-0">
                    <span class="block font-medium text-base-content">Existing default not returned by the capability catalog.</span>
                    <span class="trellis-identifier mt-0.5 block break-all text-base-content/50">{localCapabilityKey(capabilityKey)}</span>
                  </span>
                </ChoiceRow>
              {/each}
            </SelectionGroup>
          </div>
          <div class="form-control">
            <div class="mb-1 flex items-baseline justify-between gap-2">
              <span class="label-text text-xs uppercase tracking-wide text-base-content/55">Default capability groups</span>
              <span class="trellis-metadata text-[0.65rem]">{selectedDefaultCapabilityGroups.length} selected</span>
            </div>
            <SelectionGroup title="Default capability groups" count={selectedDefaultCapabilityGroups.length} bodyClass="max-h-72 overflow-y-auto rounded border border-base-300 bg-base-100/40">
              {#each sortedCapabilityGroups as group (group.groupKey)}
                <ChoiceRow>
                  {#snippet input()}
                    <input class="checkbox checkbox-sm mt-0.5" type="checkbox" checked={selectedDefaultCapabilityGroups.includes(group.groupKey)} disabled={busy} onchange={(event) => handleDefaultCapabilityGroupChange(group.groupKey, event)} />
                  {/snippet}
                  <span class="min-w-0">
                    <span class="trellis-identifier block truncate font-medium text-base-content">{group.groupKey}</span>
                    <span class="mt-0.5 block truncate text-base-content/60" title={group.displayName}>{group.displayName}</span>
                    <span class="trellis-field-help block">{group.capabilities.length} capabilities · {group.includedGroups.length} included groups</span>
                  </span>
                </ChoiceRow>
              {:else}
                <div class="px-2 py-3 trellis-metadata text-xs">No capability groups were returned.</div>
              {/each}
              {#each uncatalogedSelectedCapabilityGroups as groupKey (groupKey)}
                <ChoiceRow class="border-t">
                  {#snippet input()}
                    <input class="checkbox checkbox-sm mt-0.5" type="checkbox" checked={selectedDefaultCapabilityGroups.includes(groupKey)} disabled={busy} onchange={(event) => handleDefaultCapabilityGroupChange(groupKey, event)} />
                  {/snippet}
                  <span class="min-w-0">
                    <span class="block font-medium text-base-content">Existing default not returned by the group catalog.</span>
                    <span class="trellis-identifier mt-0.5 block break-all text-base-content/50">{groupKey}</span>
                  </span>
                </ChoiceRow>
              {/each}
            </SelectionGroup>
          </div>
        </div>
      </Panel>

      {#if editingExisting && portal}
        <Panel title="Portal routes" eyebrow={`${activeRouteCount} active / ${routes.length} total`}>
          <div class="space-y-3">
            <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <DataTable class="border-b border-base-300 bg-base-100/30">
                  <thead>
                    <tr>
                      <th>Match</th>
                      <th>Status</th>
                      <th class="hidden lg:table-cell">Updated</th>
                      <th class="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each sortedRoutes as route (route.routeKey)}
                      <tr>
                        <td class="font-mono text-xs">
                          <div>{routeMatch(route)}</div>
                          <div class="text-base-content/50">{routeKind(route)}</div>
                        </td>
                        <td><span class="badge badge-sm {route.disabled ? 'badge-neutral' : 'badge-success'}">{route.disabled ? "disabled" : "active"}</span></td>
                        <td class="hidden text-xs text-base-content/60 lg:table-cell">{formatDate(route.updatedAt)}</td>
                        <td class="text-right">
                          <button class="btn btn-ghost btn-xs" type="button" onclick={() => editRoute(route)} disabled={busy}>Edit</button>
                          <button class="btn btn-error btn-outline btn-xs" type="button" onclick={() => requestRemoveRoute(route)} disabled={busy}>{removingRouteKey === route.routeKey ? "Removing" : "Remove"}</button>
                        </td>
                      </tr>
                    {:else}
                      <tr><td class="text-xs text-base-content/60" colspan="4">No routes target this portal.</td></tr>
                    {/each}
                  </tbody>
              </DataTable>

              <div class="space-y-2 rounded border border-base-300 p-3">
                <div class="text-xs uppercase tracking-wide text-base-content/55">{editingRouteKey ? "Edit route" : "Add route"}</div>
                <label class="form-control">
                  <span class="label-text text-xs uppercase tracking-wide text-base-content/55">Contract ID</span>
                  <input class="input input-bordered input-sm font-mono" bind:value={routeContractId} disabled={busy || editingRouteKey !== null} placeholder="Blank for any contract" />
                </label>
                <label class="form-control">
                  <span class="label-text text-xs uppercase tracking-wide text-base-content/55">Origin</span>
                  <input class="input input-bordered input-sm font-mono" bind:value={routeOrigin} disabled={busy || editingRouteKey !== null} placeholder="Blank for any origin" />
                </label>
                <label class="flex items-center justify-between rounded border border-base-300 px-3 py-2 text-sm">
                  <span>Enabled</span>
                  <input class="toggle toggle-sm toggle-primary" type="checkbox" checked={!routeDisabled} disabled={busy} onchange={handleRouteEnabledChange} />
                </label>
                <div class="flex justify-end gap-2">
                  <button class="btn btn-ghost btn-xs" type="button" onclick={resetRouteForm} disabled={busy}>Clear</button>
                  <button class="btn btn-outline btn-xs" type="button" onclick={saveRoute} disabled={busy}>{savingRoute ? "Saving" : editingRouteKey ? "Update route" : "Save route"}</button>
                </div>
              </div>
            </div>
          </div>
        </Panel>
      {/if}

      <div class="flex justify-end gap-2">
        <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals")}>Cancel</a>
        <button class="btn btn-outline btn-sm" type="submit" disabled={busy}>{saving ? "Saving" : "Save portal"}</button>
      </div>
    </form>
  {/if}
</section>

<ConfirmationModal bind:this={confirmationModal} />
