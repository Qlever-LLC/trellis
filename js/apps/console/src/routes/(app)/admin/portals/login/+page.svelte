<script lang="ts">
  import type {
    AuthClearLoginPortalSelectionInput,
    AuthGetLoginPortalDefaultOutput,
    AuthListInstalledContractsOutput,
    AuthListLoginPortalSelectionsOutput,
    AuthListPortalsOutput,
    AuthSetLoginPortalDefaultInput,
    AuthSetLoginPortalSelectionInput,
  } from "@qlever-llc/trellis-sdk/auth";
  import { isErr } from "@qlever-llc/result";
  import { onMount } from "svelte";
  import { errorMessage } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  const BUILTIN_OPTION = "__builtin__";
  const INHERIT_OPTION = "__inherit__";

  type PortalRecord = AuthListPortalsOutput["portals"][number];
  type ContractRecord = AuthListInstalledContractsOutput["contracts"][number];
  type SelectionRecord = AuthListLoginPortalSelectionsOutput["selections"][number];
  type DefaultPortal = AuthGetLoginPortalDefaultOutput["defaultPortal"];

  const trellis = getTrellis();
  const notifications = getNotifications();

  async function requestValue<T>(method: string, input: unknown): Promise<T> {
    const result = await trellis.request<T>(method, input);
    const value = result.take();
    if (isErr(value)) throw value.error;
    return value as T;
  }

  let loading = $state(true);
  let error = $state<string | null>(null);

  let portals = $state<PortalRecord[]>([]);
  let contracts = $state<ContractRecord[]>([]);
  let selections = $state<SelectionRecord[]>([]);
  let defaultPortal = $state<DefaultPortal>({ portalId: null });

  let defaultDraft = $state(BUILTIN_OPTION);
  let selectionDrafts = $state<Record<string, string>>({});

  let defaultPending = $state(false);
  let saveTarget = $state<string | null>(null);
  let clearTarget = $state<string | null>(null);

  const portalById = $derived(new Map(portals.map((portal) => [portal.portalId, portal])));
  const selectionByContractId = $derived(new Map(selections.map((selection) => [selection.contractId, selection])));

  function optionToPortalId(option: string): string | null {
    return option === BUILTIN_OPTION ? null : option;
  }

  function portalIdToOption(portalId: string | null | undefined): string {
    return portalId ?? BUILTIN_OPTION;
  }

  function selectionOption(contractId: string): string {
    return portalIdToOption(selectionByContractId.get(contractId)?.portalId);
  }

  function portalLabel(portalId: string | null | undefined): string {
    if (portalId == null) return "Built-in portal";
    const portal = portalById.get(portalId);
    if (!portal) return `${portalId} (missing)`;
    return portal.disabled ? `${portal.portalId} (disabled)` : portal.portalId;
  }

  function effectivePortalLabel(contractId: string): string {
    const explicit = selectionByContractId.get(contractId);
    const portalId = explicit?.portalId ?? defaultPortal.portalId;
    const source = explicit ? "selection" : "default";
    return `${portalLabel(portalId)} · ${source}`;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [portalRes, contractRes, defaultRes, selectionRes] = await Promise.all([
        requestValue<AuthListPortalsOutput>("Auth.ListPortals", {}),
        requestValue<AuthListInstalledContractsOutput>("Auth.ListInstalledContracts", {}),
        requestValue<AuthGetLoginPortalDefaultOutput>("Auth.GetLoginPortalDefault", {}),
        requestValue<AuthListLoginPortalSelectionsOutput>("Auth.ListLoginPortalSelections", {}),
      ]);

      portals = portalRes.portals ?? [];
      contracts = contractRes.contracts ?? [];
      defaultPortal = defaultRes.defaultPortal ?? { portalId: null };
      selections = selectionRes.selections ?? [];
      defaultDraft = portalIdToOption(defaultRes.defaultPortal?.portalId);
      selectionDrafts = Object.fromEntries(
        (contractRes.contracts ?? []).map((contract) => {
          const selection = (selectionRes.selections ?? []).find((entry) => entry.contractId === contract.id);
          return [contract.id, selection ? portalIdToOption(selection.portalId) : INHERIT_OPTION];
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
      await requestValue("Auth.SetLoginPortalDefault", {
        portalId: optionToPortalId(defaultDraft),
      } satisfies AuthSetLoginPortalDefaultInput);
      notifications.success("Default login portal updated.", "Updated");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      defaultPending = false;
    }
  }

  async function saveSelection(contractId: string) {
    saveTarget = contractId;
    error = null;
    try {
      const option = selectionDrafts[contractId] ?? INHERIT_OPTION;
      if (option === INHERIT_OPTION) {
        await requestValue("Auth.ClearLoginPortalSelection", {
          contractId,
        } satisfies AuthClearLoginPortalSelectionInput);
        notifications.success(`Login policy cleared for ${contractId}.`, "Cleared");
      } else {
        await requestValue("Auth.SetLoginPortalSelection", {
          contractId,
          portalId: optionToPortalId(option),
        } satisfies AuthSetLoginPortalSelectionInput);
        notifications.success(`Login policy updated for ${contractId}.`, "Updated");
      }
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saveTarget = null;
    }
  }

  async function clearSelection(contractId: string) {
    if (!selectionByContractId.get(contractId)) return;
    if (!window.confirm(`Clear the login portal override for ${contractId}?`)) return;
    clearTarget = contractId;
    error = null;
    try {
      await requestValue("Auth.ClearLoginPortalSelection", {
        contractId,
      } satisfies AuthClearLoginPortalSelectionInput);
      notifications.success(`Login policy cleared for ${contractId}.`, "Cleared");
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
        <h2 class="card-title text-base">Default login portal</h2>
        <p class="text-sm text-base-content/60">Choose the portal used when there is no contract-specific login policy.</p>
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
  {:else if contracts.length === 0}
    <p class="text-sm text-base-content/60">No installed contracts found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Contract</th>
            <th>Current</th>
            <th>Override</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each contracts as contract (contract.digest)}
            <tr>
              <td>
                <div class="font-medium">{contract.displayName ?? contract.id}</div>
                <div class="font-mono text-xs text-base-content/60">{contract.id}</div>
              </td>
              <td class="text-sm text-base-content/60">{effectivePortalLabel(contract.id)}</td>
              <td>
                <select class="select select-bordered select-xs w-full max-w-72" bind:value={selectionDrafts[contract.id]}>
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
                    onclick={() => saveSelection(contract.id)}
                    disabled={saveTarget === contract.id || clearTarget === contract.id || selectionDrafts[contract.id] === (selectionByContractId.get(contract.id) ? selectionOption(contract.id) : INHERIT_OPTION)}
                  >
                    {saveTarget === contract.id ? "Saving…" : "Apply"}
                  </button>

                  <button
                    class="btn btn-ghost btn-xs"
                    onclick={() => clearSelection(contract.id)}
                    disabled={clearTarget === contract.id || saveTarget === contract.id || !selectionByContractId.get(contract.id)}
                  >
                    {clearTarget === contract.id ? "Clearing…" : "Clear"}
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
