<script lang="ts">
  import type {
    AuthCreatePortalInput,
    AuthDisablePortalInput,
    AuthListInstalledContractsOutput,
    AuthListPortalsOutput,
  } from "@qlever-llc/trellis-sdk/auth";
  import { isErr } from "@qlever-llc/result";
  import { onMount } from "svelte";
  import { errorMessage } from "../../../../lib/format";
  import { getNotifications } from "../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../lib/trellis";

  type PortalRecord = AuthListPortalsOutput["portals"][number];
  type ContractRecord = AuthListInstalledContractsOutput["contracts"][number];

  const trellisPromise = getTrellis();
  const notifications = getNotifications();

  async function requestOrThrow<T>(method: string, input: unknown): Promise<T> {
    const trellis = await trellisPromise;
    const result = await trellis.request<T>(method as string, input);
    const value = result.take();
    if (isErr(value)) throw value.error;
    return value as T;
  }

  let loading = $state(true);
  let error = $state<string | null>(null);
  let createPending = $state(false);
  let disableTarget = $state<string | null>(null);

  let portals = $state<PortalRecord[]>([]);
  let contracts = $state<ContractRecord[]>([]);

  let portalId = $state("");
  let entryUrl = $state("");
  let appContractId = $state("");

  const activePortalCount = $derived(portals.filter((portal) => !portal.disabled).length);
  const contractLabelById = $derived.by(() =>
    Object.fromEntries(
      contracts.map((contract) => [contract.id, contract.displayName ? `${contract.displayName} (${contract.id})` : contract.id]),
    ) as Record<string, string>,
  );

  async function load() {
    loading = true;
    error = null;
    try {
      const [portalRes, contractRes] = await Promise.all([
        requestOrThrow<AuthListPortalsOutput>("Auth.ListPortals", {}),
        requestOrThrow<AuthListInstalledContractsOutput>("Auth.ListInstalledContracts", {}),
      ]);
      portals = portalRes.portals ?? [];
      contracts = contractRes.contracts ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function createPortal() {
    createPending = true;
    error = null;
    try {
      await requestOrThrow("Auth.CreatePortal", {
        portalId: portalId.trim(),
        entryUrl: entryUrl.trim(),
        appContractId: appContractId || undefined,
      } satisfies AuthCreatePortalInput);
      notifications.success(`Portal ${portalId.trim()} created.`, "Created");
      portalId = "";
      entryUrl = "";
      appContractId = "";
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      createPending = false;
    }
  }

  async function disablePortal(portal: PortalRecord) {
    if (portal.disabled) return;
    if (!window.confirm(`Disable portal ${portal.portalId}?`)) return;
    disableTarget = portal.portalId;
    error = null;
    try {
      await requestOrThrow("Auth.DisablePortal", {
        portalId: portal.portalId,
      } satisfies AuthDisablePortalInput);
      notifications.success(`Portal ${portal.portalId} disabled.`, "Disabled");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      disableTarget = null;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <div class="flex items-center justify-between gap-4">
    <div class="stats shadow border border-base-300">
      <div class="stat py-2 px-4">
        <div class="stat-title text-xs">Active portals</div>
        <div class="stat-value text-xl">{activePortalCount}</div>
      </div>
    </div>

    <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
  </div>

  <div class="card border border-base-300 bg-base-100">
    <div class="card-body gap-4">
      <div>
        <h2 class="card-title text-base">Create portal</h2>
        <p class="text-sm text-base-content/60">Register a portal entry URL and optionally associate it with an installed app contract.</p>
      </div>

      <form class="grid gap-3 md:grid-cols-[1fr_2fr_1.5fr_auto] md:items-end" onsubmit={(event) => { event.preventDefault(); void createPortal(); }}>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Portal ID</span>
          <input class="input input-bordered input-sm" bind:value={portalId} placeholder="portal-login" required />
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">Entry URL</span>
          <input class="input input-bordered input-sm" bind:value={entryUrl} placeholder="https://portal.example.com/" required />
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">App contract</span>
          <select class="select select-bordered select-sm" bind:value={appContractId}>
            <option value="">None</option>
            {#each contracts as contract (contract.digest)}
              <option value={contract.id}>{contractLabelById[contract.id]}</option>
            {/each}
          </select>
        </label>

        <button type="submit" class="btn btn-primary btn-sm" disabled={createPending}>
          {createPending ? "Creating…" : "Create Portal"}
        </button>
      </form>
    </div>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
  {:else if portals.length === 0}
    <p class="text-sm text-base-content/60">No portals found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Portal</th>
            <th>Entry URL</th>
            <th>App contract</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each portals as portal (portal.portalId)}
            <tr>
              <td class="font-medium">{portal.portalId}</td>
              <td>
                <a class="link link-hover font-mono text-xs" href={portal.entryUrl} target="_blank" rel="noreferrer">{portal.entryUrl}</a>
              </td>
              <td class="text-base-content/60">{portal.appContractId ? contractLabelById[portal.appContractId] ?? portal.appContractId : "—"}</td>
              <td>
                {#if portal.disabled}
                  <span class="badge badge-ghost badge-sm">Disabled</span>
                {:else}
                  <span class="badge badge-success badge-sm">Active</span>
                {/if}
              </td>
              <td class="text-right">
                <button
                  class="btn btn-ghost btn-xs text-error"
                  onclick={() => disablePortal(portal)}
                  disabled={portal.disabled || disableTarget === portal.portalId}
                >
                  {disableTarget === portal.portalId ? "Disabling…" : "Disable"}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-base-content/50">{portals.length} portal{portals.length !== 1 ? "s" : ""}</p>
  {/if}
</section>
