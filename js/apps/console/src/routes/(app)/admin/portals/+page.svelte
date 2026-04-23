<script lang="ts">
  import type { TrellisContractV1 } from "@qlever-llc/trellis";
  import type {
    AuthCreatePortalInput,
    AuthDisablePortalInput,
    AuthGetInstalledContractOutput,
    AuthListInstalledContractsOutput,
    AuthListPortalsOutput,
    AuthUpsertInstanceGrantPolicyInput,
  } from "@qlever-llc/trellis-sdk/auth";
  import { isErr } from "@qlever-llc/result";
  import { onMount } from "svelte";
  import { errorMessage } from "../../../../lib/format";
  import { getNotifications } from "../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../lib/trellis";

  type PortalRecord = AuthListPortalsOutput["portals"][number];
  type ContractRecord = AuthListInstalledContractsOutput["contracts"][number];
  type ContractLineage = {
    id: string;
    displayName: string;
    digests: string[];
  };
  type CreateFeedback = {
    tone: "success" | "error";
    message: string;
  };

  const trellisPromise = getTrellis();
  const notifications = getNotifications();

  async function requestValue<T>(method: string, input: unknown): Promise<T> {
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
  let derivePending = $state(false);

  let portals = $state<PortalRecord[]>([]);
  let contracts = $state<ContractRecord[]>([]);

  let portalId = $state("");
  let entryUrl = $state("");
  let createGrantPolicy = $state(false);
  let selectedContractId = $state("");
  let impliedCapabilitiesText = $state("");
  let allowedOriginsText = $state("");
  let createFeedback = $state<CreateFeedback | null>(null);

  let contractDetailCache = $state.raw<Record<string, AuthGetInstalledContractOutput["contract"]>>({});
  let deriveRequestVersion = 0;

  const activePortalCount = $derived(portals.filter((portal) => !portal.disabled).length);
  const lineages = $derived.by(() => {
    const byId: Record<string, ContractLineage> = {};

    for (const contract of contracts) {
      const existing = byId[contract.id];
      if (existing) {
        if (!existing.digests.includes(contract.digest)) {
          existing.digests = [...existing.digests, contract.digest];
        }
        if (!existing.displayName && contract.displayName) {
          existing.displayName = contract.displayName;
        }
        continue;
      }

      byId[contract.id] = {
        id: contract.id,
        displayName: contract.displayName || contract.id,
        digests: [contract.digest],
      };
    }

    return Object.values(byId).sort((left, right) =>
      (left.displayName || left.id).localeCompare(right.displayName || right.id)
    );
  });
  const lineageById = $derived(
    Object.fromEntries(lineages.map((lineage) => [lineage.id, lineage])) as Record<string, ContractLineage>,
  );

  function parseCsv(value: string): string[] {
    const values: string[] = [];

    for (const entry of value.split(",").map((part) => part.trim()).filter(Boolean)) {
      if (values.includes(entry)) continue;
      values.push(entry);
    }

    return values;
  }

  function addCapabilities(target: Set<string>, values: readonly string[] | undefined) {
    for (const value of values ?? []) {
      if (value) target.add(value);
    }
  }

  function resetCreateFields() {
    portalId = "";
    entryUrl = "";
    createGrantPolicy = false;
    selectedContractId = "";
    impliedCapabilitiesText = "";
    allowedOriginsText = "";
    derivePending = false;
    createFeedback = null;
  }

  async function getInstalledContractDetail(digest: string) {
    const cached = contractDetailCache[digest];
    if (cached) return cached;

    const detail = await requestValue<AuthGetInstalledContractOutput>("Auth.GetInstalledContract", {
      digest,
    });
    contractDetailCache = {
      ...contractDetailCache,
      [digest]: detail.contract,
    };
    return detail.contract;
  }

  async function deriveCapabilitiesForContract(contractId: string): Promise<string[]> {
    const digest = lineageById[contractId]?.digests[0];
    if (!digest) return [];

    const detail = await getInstalledContractDetail(digest);
    const contract = detail.contract as TrellisContractV1;
    const capabilities = new Set<string>();

    for (const event of Object.values(contract.events ?? {})) {
      addCapabilities(capabilities, event.capabilities?.publish);
    }

    for (const subject of Object.values(contract.subjects ?? {})) {
      addCapabilities(capabilities, subject.capabilities?.publish);
      addCapabilities(capabilities, subject.capabilities?.subscribe);
    }

    for (const dependencyUse of Object.values(contract.uses ?? {})) {
      const dependencyDigest = lineageById[dependencyUse.contract]?.digests[0];
      if (!dependencyDigest) continue;

      const dependencyDetail = await getInstalledContractDetail(dependencyDigest);
      const dependency = dependencyDetail.contract as TrellisContractV1;

      for (const key of dependencyUse.rpc?.call ?? []) {
        addCapabilities(capabilities, dependency.rpc?.[key]?.capabilities?.call);
      }

      for (const key of dependencyUse.operations?.call ?? []) {
        addCapabilities(capabilities, dependency.operations?.[key]?.capabilities?.call);
      }

      for (const key of dependencyUse.events?.publish ?? []) {
        addCapabilities(capabilities, dependency.events?.[key]?.capabilities?.publish);
      }

      for (const key of dependencyUse.events?.subscribe ?? []) {
        addCapabilities(capabilities, dependency.events?.[key]?.capabilities?.subscribe);
      }

      for (const key of dependencyUse.subjects?.publish ?? []) {
        addCapabilities(capabilities, dependency.subjects?.[key]?.capabilities?.publish);
      }

      for (const key of dependencyUse.subjects?.subscribe ?? []) {
        addCapabilities(capabilities, dependency.subjects?.[key]?.capabilities?.subscribe);
      }
    }

    return [...capabilities].sort((left, right) => left.localeCompare(right));
  }

  async function refreshDerivedCapabilities(contractId: string) {
    const requestVersion = ++deriveRequestVersion;

    if (!contractId) {
      derivePending = false;
      impliedCapabilitiesText = "";
      return;
    }

    derivePending = true;
    try {
      const capabilities = await deriveCapabilitiesForContract(contractId);
      if (requestVersion !== deriveRequestVersion || selectedContractId !== contractId) return;
      impliedCapabilitiesText = capabilities.join(", ");
    } catch (e) {
      if (requestVersion !== deriveRequestVersion || selectedContractId !== contractId) return;
      error = `Failed to derive capabilities for ${contractId}: ${errorMessage(e)}`;
      notifications.error(error, "Capability derivation failed");
    } finally {
      if (requestVersion === deriveRequestVersion) {
        derivePending = false;
      }
    }
  }

  async function handleContractSelectionChange() {
    createFeedback = null;
    error = null;
    await refreshDerivedCapabilities(selectedContractId.trim());
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [portalRes, contractRes] = await Promise.all([
        requestValue<AuthListPortalsOutput>("Auth.ListPortals", {}),
        requestValue<AuthListInstalledContractsOutput>("Auth.ListInstalledContracts", {}),
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
    const nextPortalId = portalId.trim();
    const nextEntryUrl = entryUrl.trim();
    const nextContractId = selectedContractId.trim();
    const nextAllowedOrigins = parseCsv(allowedOriginsText);
    const shouldCreatePolicy = createGrantPolicy && !!nextContractId;

    if (createGrantPolicy && !nextContractId) {
      error = "Select a contract lineage to create the instance grant policy.";
      createFeedback = { tone: "error", message: error };
      return;
    }

    createPending = true;
    error = null;
    createFeedback = null;
    let portalCreated = false;
    try {
      await requestValue("Auth.CreatePortal", {
        portalId: nextPortalId,
        entryUrl: nextEntryUrl,
      } satisfies AuthCreatePortalInput);

      portalCreated = true;

      if (shouldCreatePolicy) {
        await requestValue("Auth.UpsertInstanceGrantPolicy", {
          contractId: nextContractId,
          impliedCapabilities: parseCsv(impliedCapabilitiesText),
          allowedOrigins: nextAllowedOrigins.length ? nextAllowedOrigins : undefined,
        } satisfies AuthUpsertInstanceGrantPolicyInput);
      }

      const successMessage = shouldCreatePolicy
        ? `Portal ${nextPortalId} created and instance grant policy saved for ${nextContractId}.`
        : `Portal ${nextPortalId} created.`;
      notifications.success(successMessage, shouldCreatePolicy ? "Created & Saved" : "Created");
      createFeedback = { tone: "success", message: successMessage };
      resetCreateFields();
      await load();
    } catch (e) {
      const message = errorMessage(e);
      error = portalCreated && shouldCreatePolicy
        ? `Portal ${nextPortalId} created, but the instance grant policy for ${nextContractId} could not be saved: ${message}`
        : message;
      createFeedback = { tone: "error", message: error };
      notifications.error(error, portalCreated ? "Partial failure" : "Create failed");
      if (portalCreated) {
        portalId = "";
        entryUrl = "";
        await load();
      }
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
      await requestValue("Auth.DisablePortal", {
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
        <p class="text-sm text-base-content/60">Register a portal ID and entry URL for a portal route, with an optional instance grant policy for the selected contract lineage.</p>
      </div>

      <form class="grid gap-3 md:grid-cols-2" onsubmit={(event) => { event.preventDefault(); void createPortal(); }}>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Portal ID</span>
          <input class="input input-bordered input-sm" bind:value={portalId} placeholder="portal-login" required />
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">Entry URL</span>
          <input class="input input-bordered input-sm" bind:value={entryUrl} placeholder="https://portal.example.com/" required />
        </label>

        <div class="form-control gap-2 md:col-span-2">
          <label class="label cursor-pointer justify-start gap-3 rounded-lg border border-base-300 px-3 py-2">
            <input class="checkbox checkbox-sm" type="checkbox" bind:checked={createGrantPolicy} />
            <span class="label-text">Also create an instance grant policy</span>
          </label>
        </div>

        {#if createGrantPolicy}
          <label class="form-control gap-1 md:col-span-2">
            <span class="label-text text-xs">Contract lineage</span>
            <select
              class="select select-bordered select-sm"
              bind:value={selectedContractId}
              onchange={() => void handleContractSelectionChange()}
              required={createGrantPolicy}
            >
              <option value="">Select a contract lineage</option>
              {#each lineages as lineage (lineage.id)}
                <option value={lineage.id}>{lineage.displayName} ({lineage.id})</option>
              {/each}
            </select>
            {#if selectedContractId && lineageById[selectedContractId]}
              <span class="label-text-alt text-base-content/50">
                {lineageById[selectedContractId].digests.length} installed digest{lineageById[selectedContractId].digests.length !== 1 ? "s" : ""}
              </span>
            {/if}
          </label>

          <label class="form-control gap-1 md:col-span-2">
            <span class="label-text text-xs">Implied capabilities</span>
            <textarea
              class="textarea textarea-bordered textarea-sm min-h-24 font-mono"
              bind:value={impliedCapabilitiesText}
              placeholder="contracts.read, approvals.manage"
            ></textarea>
            <span class="label-text-alt text-base-content/50">
              {derivePending ? "Deriving from the selected contract..." : "Prefilled from the selected contract lineage. Review or edit before save."}
            </span>
          </label>

          <label class="form-control gap-1 md:col-span-2">
            <span class="label-text text-xs">Allowed origins</span>
            <textarea
              class="textarea textarea-bordered textarea-sm min-h-24 font-mono"
              bind:value={allowedOriginsText}
              placeholder="https://console.example.com, https://portal.example.com"
            ></textarea>
            <span class="label-text-alt text-base-content/50">Optional comma-separated origins. Leave blank to allow any origin.</span>
          </label>
        {/if}

        <div class="md:col-span-2 flex flex-wrap items-center gap-2">
          <button type="submit" class="btn btn-primary btn-sm" disabled={createPending || (createGrantPolicy && !selectedContractId.trim())}>
            {createPending ? "Creating…" : createGrantPolicy ? "Create Portal & Policy" : "Create Portal"}
          </button>

          <button type="button" class="btn btn-ghost btn-sm" onclick={resetCreateFields} disabled={createPending}>
            Clear
          </button>
        </div>
      </form>

      {#if createFeedback}
        <div class={["alert", createFeedback.tone === "success" ? "alert-success" : "alert-error"]}>
          <span>{createFeedback.message}</span>
        </div>
      {/if}
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
